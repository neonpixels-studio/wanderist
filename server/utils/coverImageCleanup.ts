/**
 * Cleanup for media left behind when a trip's cover image changes.
 *
 * Changing a trip's cover overwrites `trips.cover_image_id`, which would
 * otherwise orphan the previously-referenced media row and its Netlify Blobs
 * object forever. A media row can also be referenced by another trip's cover
 * or by an entry photo, so we only delete media that nothing else references.
 *
 * The Netlify Blobs interaction lives behind `mediaStore` so this logic can be
 * unit-tested without touching the network.
 */
import { eq, and, sql, type SQL } from "drizzle-orm";
import type { getDb } from "../db/index";
import { media, trips, entryPhotos } from "../db/schema";
import { removeMediaBlob, toThumbnailKey } from "./mediaStore";

type Database = ReturnType<typeof getDb>;

// Matches the owner's media row only when nothing references it. Folding the
// NOT EXISTS reference check into the DELETE's own WHERE collapses the former
// two-statement check-then-delete into one statement, so there is no
// multi-statement gap for a concurrent insert to land in and then be lost.
//
// This narrows but does not eliminate the race: under the default READ
// COMMITTED a reference that commits inside the delete's snapshot window can
// still slip through, and the two FKs resolve it differently — an entry photo
// (media_id CASCADE) would be deleted with the media, a trip cover
// (cover_image_id SET NULL) would be silently nulled. Fully serializing against
// that would need SERIALIZABLE + retry or a FOR UPDATE lock on the media row —
// out of scope here.
function unreferencedOwnedMedia(ownerId: string, mediaId: string): SQL {
  // and() is typed SQL | undefined (undefined only when every argument is), so
  // the cast is safe for this fixed, non-empty clause list. The exact compiled
  // predicate is pinned in the test, which fails loudly if a clause is dropped.
  return and(
    eq(media.id, mediaId),
    eq(media.userId, ownerId),
    sql`not exists (select 1 from ${trips} where ${trips.coverImageId} = ${mediaId})`,
    sql`not exists (select 1 from ${entryPhotos} where ${entryPhotos.mediaId} = ${mediaId})`,
  ) as SQL;
}

// Blob removal is best-effort: a leaked blob can be reaped out-of-band, so a
// failure here is logged rather than thrown (which would surface a 500 on an
// otherwise-successful trip update).
async function removeBlobQuietly(storageKey: string): Promise<void> {
  try {
    await removeMediaBlob(storageKey);
  } catch (blobError) {
    console.error(
      `cover cleanup: blob removal failed for ${storageKey}`,
      blobError,
    );
  }
}

async function removeStoredBlobs(storageKey: string): Promise<void> {
  await removeBlobQuietly(storageKey);
  // The thumbnail may never have been generated (best-effort at upload time);
  // removeMediaBlob deleting a missing key is a no-op, not an error.
  await removeBlobQuietly(toThumbnailKey(storageKey));
}

/**
 * Throws 404 unless `mediaId` names a media row owned by `ownerId`. Guards the
 * PATCH from pointing a trip's cover at a nonexistent or another user's media
 * (the FK alone would surface a 500, and cross-user references would leak).
 */
export async function assertCoverImageOwned(
  database: Database,
  ownerId: string,
  mediaId: string,
): Promise<void> {
  const rows = await database
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.userId, ownerId)))
    .limit(1);

  if (!rows[0]) {
    throw createError({
      statusCode: 404,
      statusMessage: "Cover image not found",
    });
  }
}

/**
 * Deletes the given media row and its blobs, but only when no trip cover or
 * entry photo still references it. Scoped to `ownerId` so cleanup can never
 * touch another user's media. Returns true when it deleted the media, false
 * when it left it in place (still referenced, or already gone).
 *
 * Call this only after the trip has been updated away from `mediaId`, so the
 * reference check does not see the trip that just released it.
 */
export async function deleteMediaIfUnreferenced(
  database: Database,
  ownerId: string,
  mediaId: string,
): Promise<boolean> {
  // RETURNING reports whether a row was actually removed and its blob storage
  // key (media.url holds the storage key: insertMediaRow sets url = storageKey),
  // distinguishing "deleted" from "left in place (referenced or gone)".
  const deletedRows = await database
    .delete(media)
    .where(unreferencedOwnedMedia(ownerId, mediaId))
    .returning({ url: media.url });

  const deletedRow = deletedRows[0];

  if (!deletedRow) {
    return false;
  }

  // The row is already gone, so the reference is cleared even if blob removal
  // fails; an orphaned blob can be reaped out-of-band, an orphaned row cannot.
  await removeStoredBlobs(deletedRow.url);

  return true;
}
