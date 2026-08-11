import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index";
import { trips, entries, entryPhotos } from "../../db/schema";
import { requireTripId, loadOwnedTrip } from "../../utils/trip-helpers";
import { deleteMediaIfUnreferenced } from "../../utils/coverImageCleanup";

type Trip = typeof trips.$inferSelect;
type Database = ReturnType<typeof getDb>;

// Cap on concurrent media reconciliations. A trip aggregates the photos of all
// its entries, so the media set is unbounded; firing every cleanup at once
// would open that many simultaneous neon-http round trips from one invocation.
const PHOTO_MEDIA_CLEANUP_CONCURRENCY = 8;

// Photo media ids are captured BEFORE the delete: the trip's entries and their
// photos go with it, so afterwards nothing records which media they referenced.
// Scoped to the owner's entries (matching the delete below) so a foreign entry
// attached to this trip is never collected. This runs outside the delete batch,
// so a photo added to the trip in the gap is left to out-of-band media reaping
// — the same escape hatch the best-effort cleanup failures rely on.
async function collectTripPhotoMediaIds(
  database: Database,
  tripId: string,
  ownerId: string,
): Promise<string[]> {
  const rows = await database
    .select({ mediaId: entryPhotos.mediaId })
    .from(entryPhotos)
    .innerJoin(entries, eq(entryPhotos.entryId, entries.id))
    .where(and(eq(entries.tripId, tripId), eq(entries.userId, ownerId)));

  return [...new Set(rows.map((row) => row.mediaId))];
}

// entries.trip_id is ON DELETE SET NULL, so deleting the trip alone would only
// detach its entries and strand their photo media; the owner's entries are
// deleted explicitly (entry_photos/entry_tags/entry_likes cascade off that). A
// foreign user's entry attached to the trip is left for the FK to detach, not
// destroyed. Both statements run in one batch — neon-http's atomic unit, since
// the http driver has no interactive transactions — entries first so they still
// match on trip_id before the trip row goes.
async function deleteTripWithEntries(
  database: Database,
  tripId: string,
  ownerId: string,
): Promise<void> {
  await database.batch([
    database
      .delete(entries)
      .where(and(eq(entries.tripId, tripId), eq(entries.userId, ownerId))),
    database.delete(trips).where(eq(trips.id, tripId)),
  ]);
}

// Best-effort: runs after the trip row is gone so the reference check does not
// see the trip that just released the media. A failed cover cleanup is logged,
// not thrown, so it never fails the committed delete.
async function cleanupCoverMedia(
  database: Database,
  trip: Trip,
): Promise<void> {
  const mediaId = trip.coverImageId;

  if (mediaId === null) {
    return;
  }

  try {
    await deleteMediaIfUnreferenced(database, trip.userId, mediaId);
  } catch (cleanupError) {
    console.error(
      `trip delete: cover image cleanup failed for ${mediaId}`,
      cleanupError,
    );
  }
}

// Best-effort: an orphaned media row/blob is reapable out-of-band, so a failed
// cleanup is logged (not thrown) and never fails the committed delete.
// deleteMediaIfUnreferenced re-checks references, so media still used elsewhere
// is left alone. Returns false on error so the caller can tally partial
// failures.
async function cleanupOnePhotoMedia(
  database: Database,
  ownerId: string,
  tripId: string,
  mediaId: string,
): Promise<boolean> {
  try {
    await deleteMediaIfUnreferenced(database, ownerId, mediaId);
    return true;
  } catch (cleanupError) {
    console.error(
      `trip delete: photo media cleanup failed for trip ${tripId}, media ${mediaId}`,
      cleanupError,
    );
    return false;
  }
}

// Runs after the trip and its entries/photos are gone so the reference check
// does not see the photos that just released the media. Cleanups run in bounded
// concurrent chunks: enough parallelism that a photo-heavy trip does not
// serialise into a timeout, without opening one round trip per photo. Each
// cleanup swallows its own error, so one failure never aborts the others; a
// summary line surfaces partial failures beyond the per-media logs.
async function cleanupTripPhotoMedia(
  database: Database,
  ownerId: string,
  tripId: string,
  mediaIds: string[],
): Promise<void> {
  const results: boolean[] = [];

  for (
    let start = 0;
    start < mediaIds.length;
    start += PHOTO_MEDIA_CLEANUP_CONCURRENCY
  ) {
    const chunk = mediaIds.slice(
      start,
      start + PHOTO_MEDIA_CLEANUP_CONCURRENCY,
    );
    // eslint-disable-next-line no-await-in-loop -- chunks run sequentially on purpose to bound concurrency
    const chunkResults = await Promise.all(
      chunk.map((mediaId) =>
        cleanupOnePhotoMedia(database, ownerId, tripId, mediaId),
      ),
    );
    results.push(...chunkResults);
  }

  const failureCount = results.filter((succeeded) => !succeeded).length;

  if (failureCount === 0) {
    return;
  }

  console.error(
    `trip delete: ${failureCount} of ${mediaIds.length} photo media cleanups failed for trip ${tripId}`,
  );
}

export default defineEventHandler(async (event) => {
  const tripId = requireTripId(event);

  const existing = await loadOwnedTrip(event, tripId);

  const database = getDb();

  // Drop the cover from the photo set: cleanupCoverMedia already reconciles it,
  // and a media used as both an entry photo and the cover would otherwise be
  // reconciled twice.
  const photoMediaIds = (
    await collectTripPhotoMediaIds(database, tripId, existing.userId)
  ).filter((mediaId) => mediaId !== existing.coverImageId);

  await deleteTripWithEntries(database, tripId, existing.userId);

  // Reconciliation runs after the batch commits so the reference checks see the
  // released rows. Both cleanups re-check live references, so media still used
  // elsewhere (another trip's cover, a surviving entry photo) is left untouched.
  await cleanupCoverMedia(database, existing);

  await cleanupTripPhotoMedia(database, existing.userId, tripId, photoMediaIds);

  return { ok: true };
});
