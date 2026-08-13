/**
 * Ownership checks for media referenced from request bodies.
 *
 * The entry create/update endpoints accept an arbitrary `photoMediaIds` list
 * and attach each as an entry photo. Without an owner check a caller can attach
 * another user's media id: the row's FK is satisfied (the media exists), so the
 * insert succeeds, leaking the other user's media into this entry and neutering
 * cleanup (the media now looks referenced and is never reaped). This mirrors
 * `assertCoverImageOwned` for the single-media cover case.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db/index";
import { media } from "../db/schema";

type Database = ReturnType<typeof getDb>;

/**
 * Throws 404 unless every id in `mediaIds` names a media row owned by
 * `ownerId`. Duplicate ids are de-duplicated before the check; an empty list is
 * a no-op. Rejects the whole request if any single id is missing or foreign, so
 * a partial-ownership list never writes some photos and drops others.
 */
export async function assertPhotoMediaOwned(
  database: Database,
  ownerId: string,
  mediaIds: string[],
): Promise<void> {
  const uniqueMediaIds = [...new Set(mediaIds)];

  if (uniqueMediaIds.length === 0) {
    return;
  }

  const ownedRows = await database
    .select({ id: media.id })
    .from(media)
    .where(and(inArray(media.id, uniqueMediaIds), eq(media.userId, ownerId)));

  if (ownedRows.length === uniqueMediaIds.length) {
    return;
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Photo media not found",
  });
}
