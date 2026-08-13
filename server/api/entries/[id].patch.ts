import { eq } from "drizzle-orm";
import {
  loadOwnedOrThrow,
  optionalString,
  requireRouterParam,
} from "../../utils/db-helpers";
import { getDb } from "../../db/index";
import { entries, entryPhotos, entryTags } from "../../db/schema";
import { deleteMediaIfUnreferenced } from "../../utils/coverImageCleanup";
import { assertPhotoMediaOwned } from "../../utils/media-helpers";
import {
  generateId,
  parseOccurredAt,
  parseStringArray,
  upsertTags,
  loadEntryRelations,
  VALID_VISIBILITY,
  type EntryVisibility,
} from "../../utils/entry-helpers";

type Entry = typeof entries.$inferSelect;
type EntryUpdates = Partial<typeof entries.$inferInsert>;
type DbClient = ReturnType<typeof getDb>;

function applyTitle(
  updates: EntryUpdates,
  body: Record<string, unknown>,
): void {
  const title = optionalString(body.title, "title");
  if (title === undefined) {
    return;
  }
  const trimmedTitle = title.trim();
  if (trimmedTitle === "") {
    throw createError({
      statusCode: 400,
      statusMessage: "title must not be empty when provided",
    });
  }
  updates.title = trimmedTitle;
}

function applyVisibility(
  updates: EntryUpdates,
  body: Record<string, unknown>,
): void {
  const visibility = body.visibility;
  if (visibility === undefined || visibility === null) {
    return;
  }
  if (!VALID_VISIBILITY.includes(visibility as EntryVisibility)) {
    throw createError({
      statusCode: 400,
      statusMessage: `visibility must be one of: ${VALID_VISIBILITY.join(", ")}`,
    });
  }
  updates.visibility = visibility as EntryVisibility;
}

function applyOccurredAt(
  updates: EntryUpdates,
  body: Record<string, unknown>,
): void {
  if (body.occurredAt === undefined || body.occurredAt === null) {
    return;
  }
  updates.occurredAt = parseOccurredAt(body.occurredAt);
}

async function replaceEntryTags(
  tx: DbClient,
  entryId: string,
  tagNames: string[],
): Promise<void> {
  await tx.delete(entryTags).where(eq(entryTags.entryId, entryId));

  const tagIds = await upsertTags(tx, tagNames);
  if (tagIds.length === 0) {
    return;
  }

  await tx
    .insert(entryTags)
    .values(tagIds.map((tagId) => ({ entryId, tagId })));
}

async function replaceEntryPhotos(
  tx: DbClient,
  entryId: string,
  mediaIds: string[],
): Promise<void> {
  await tx.delete(entryPhotos).where(eq(entryPhotos.entryId, entryId));

  if (mediaIds.length === 0) {
    return;
  }

  await tx.insert(entryPhotos).values(
    mediaIds.map((mediaId, index) => ({
      id: generateId(),
      entryId,
      mediaId,
      sortOrder: index,
    })),
  );
}

// Captured BEFORE the replace: once replaceEntryPhotos deletes the old rows
// there is nothing left to tell us which media they pointed at.
async function collectEntryPhotoMediaIds(
  tx: DbClient,
  entryId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ mediaId: entryPhotos.mediaId })
    .from(entryPhotos)
    .where(eq(entryPhotos.entryId, entryId));

  return [...new Set(rows.map((row) => row.mediaId))];
}

// The media ids present before the replace but absent from the new set — the
// ones this PATCH released. Media still referenced by the new set stays out of
// cleanup entirely.
function mediaIdsNoLongerReferenced(
  previousMediaIds: string[],
  nextMediaIds: string[],
): string[] {
  const nextMediaIdSet = new Set(nextMediaIds);
  return previousMediaIds.filter((mediaId) => !nextMediaIdSet.has(mediaId));
}

// Best-effort: a failed media cleanup must not fail an otherwise-successful
// entry update. The old media is only orphaned, not corrupt, so we log and move
// on rather than surfacing a 500. deleteMediaIfUnreferenced re-checks live
// references, so a media row still used by another entry photo or a trip cover
// is left untouched. Returns false when the cleanup errored.
async function cleanupOneReplacedMedia(
  database: DbClient,
  ownerId: string,
  entryId: string,
  mediaId: string,
): Promise<boolean> {
  try {
    await deleteMediaIfUnreferenced(database, ownerId, mediaId);
    return true;
  } catch (cleanupError) {
    console.error(
      `entry patch: photo media cleanup failed for entry ${entryId}, media ${mediaId}`,
      cleanupError,
    );
    return false;
  }
}

// Runs after the entry's photo rows are replaced and the transaction has
// committed, so the reference check does not see the row that just released the
// media. Cleanups run concurrently and each swallows its own error, so one
// failure never aborts the others; a summary line surfaces partial failures
// beyond the per-media logs.
async function cleanupReplacedPhotoMedia(
  database: DbClient,
  ownerId: string,
  entryId: string,
  mediaIds: string[],
): Promise<void> {
  const results = await Promise.all(
    mediaIds.map((mediaId) =>
      cleanupOneReplacedMedia(database, ownerId, entryId, mediaId),
    ),
  );

  const failureCount = results.filter((succeeded) => !succeeded).length;

  if (failureCount > 0) {
    console.error(
      `entry patch: ${failureCount} of ${mediaIds.length} photo media cleanups failed for entry ${entryId}`,
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
  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>;
  const updates: EntryUpdates = {};

  applyTitle(updates, body);
  applyVisibility(updates, body);
  applyOccurredAt(updates, body);

  const bodyText = optionalString(body?.body, "body");
  if (bodyText !== undefined) {
    updates.body = bodyText;
  }

  const tripId = optionalString(body?.tripId, "tripId");
  if (tripId !== undefined) {
    updates.tripId = tripId;
  }

  const placeId = optionalString(body?.placeId, "placeId");
  if (placeId !== undefined) {
    updates.placeId = placeId;
  }

  const weather = optionalString(body?.weather, "weather");
  if (weather !== undefined) {
    updates.weather = weather;
  }

  const tagNames = parseStringArray(body?.tags, "tags");
  const photoMediaIds = parseStringArray(body?.photoMediaIds, "photoMediaIds");

  const hasScalarUpdates = Object.keys(updates).length > 0;
  const hasTagUpdates = tagNames !== undefined;
  const hasPhotoUpdates = photoMediaIds !== undefined;

  if (!hasScalarUpdates && !hasTagUpdates && !hasPhotoUpdates) {
    throw createError({
      statusCode: 400,
      statusMessage: "No valid fields provided for update",
    });
  }

  // Reject foreign/nonexistent photo media before the transaction: a media id
  // the entry owner doesn't own would otherwise replace the entry's photos.
  if (photoMediaIds !== undefined) {
    await assertPhotoMediaOwned(database, entry.userId, photoMediaIds);
  }

  const { payload, removedMediaIds } = await database.transaction(
    async (transaction) => {
      const txClient = transaction as unknown as DbClient;

      let updated: Entry | null = null;

      if (hasScalarUpdates) {
        const rows = await txClient
          .update(entries)
          .set(updates)
          .where(eq(entries.id, id))
          .returning();
        updated = rows[0];
      }

      if (tagNames !== undefined) {
        await replaceEntryTags(txClient, id, tagNames);
      }

      let removedMediaIds: string[] = [];
      if (photoMediaIds !== undefined) {
        const previousMediaIds = await collectEntryPhotoMediaIds(txClient, id);
        await replaceEntryPhotos(txClient, id, photoMediaIds);
        removedMediaIds = mediaIdsNoLongerReferenced(
          previousMediaIds,
          photoMediaIds,
        );
      }

      if (!updated) {
        const rows = await txClient
          .select()
          .from(entries)
          .where(eq(entries.id, id));
        updated = rows[0];
      }

      const relations = await loadEntryRelations(txClient, id);

      return { payload: { ...updated, ...relations }, removedMediaIds };
    },
  );

  // Cleanup runs only after the transaction commits so deleteMediaIfUnreferenced
  // sees the new photo rows and never deletes media the replace kept.
  await cleanupReplacedPhotoMedia(database, entry.userId, id, removedMediaIds);

  return payload;
});
