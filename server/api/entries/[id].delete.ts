import { eq } from "drizzle-orm";
import { loadOwnedOrThrow, requireRouterParam } from "../../utils/db-helpers";
import { getDb } from "../../db/index";
import { entries, entryPhotos } from "../../db/schema";
import { deleteMediaIfUnreferenced } from "../../utils/coverImageCleanup";

type Entry = typeof entries.$inferSelect;
type Database = ReturnType<typeof getDb>;

// The entry's photos cascade away with the entry (entry_photos.entry_id ON
// DELETE CASCADE), so their media ids must be captured BEFORE the delete —
// afterwards there is no row left to tell us which media they pointed at.
async function collectEntryPhotoMediaIds(
  database: Database,
  entryId: string,
): Promise<string[]> {
  const rows = await database
    .select({ mediaId: entryPhotos.mediaId })
    .from(entryPhotos)
    .where(eq(entryPhotos.entryId, entryId));

  return [...new Set(rows.map((row) => row.mediaId))];
}

// Best-effort: a failed media cleanup must not fail an otherwise-successful
// entry deletion. The media is only orphaned, not corrupt, so we log and move
// on rather than surfacing a 500. deleteMediaIfUnreferenced re-checks live
// references, so a media row still used by another entry photo or a trip cover
// is left untouched.
// Returns false when the cleanup errored so the caller can surface a partial
// failure. The error is only logged (not thrown): the entry delete already
// committed, and an orphaned media row/blob is reapable out-of-band.
async function cleanupOnePhotoMedia(
  database: Database,
  ownerId: string,
  entryId: string,
  mediaId: string,
): Promise<boolean> {
  try {
    await deleteMediaIfUnreferenced(database, ownerId, mediaId);
    return true;
  } catch (cleanupError) {
    console.error(
      `entry delete: photo media cleanup failed for entry ${entryId}, media ${mediaId}`,
      cleanupError,
    );
    return false;
  }
}

// Runs after the entry (and its cascaded photo rows) are gone so the reference
// check does not see the photo that just released the media. Cleanups run
// concurrently so a photo-heavy entry does not serialise into enough round
// trips to blow the function timeout on a delete that already committed; each
// cleanup swallows its own error, so one failure never aborts the others. A
// summary line surfaces partial failures beyond the per-media logs.
async function cleanupEntryPhotoMedia(
  database: Database,
  ownerId: string,
  entryId: string,
  mediaIds: string[],
): Promise<void> {
  const results = await Promise.all(
    mediaIds.map((mediaId) =>
      cleanupOnePhotoMedia(database, ownerId, entryId, mediaId),
    ),
  );

  const failureCount = results.filter((succeeded) => !succeeded).length;

  if (failureCount > 0) {
    console.error(
      `entry delete: ${failureCount} of ${mediaIds.length} photo media cleanups failed for entry ${entryId}`,
    );
  }
}

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");

  const entry = await loadOwnedOrThrow<Entry>(
    event,
    entries,
    entries.id,
    entries.userId,
    id,
  );

  const database = getDb();

  const mediaIds = await collectEntryPhotoMediaIds(database, id);

  await database.delete(entries).where(eq(entries.id, id));

  await cleanupEntryPhotoMedia(database, entry.userId, id, mediaIds);

  return { success: true };
});
