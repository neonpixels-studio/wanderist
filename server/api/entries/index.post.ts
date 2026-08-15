import { eq } from "drizzle-orm";
import { ensureUser } from "../../utils/auth";
import { getDb } from "../../db/index";
import { entries, entryPhotos, entryTags } from "../../db/schema";
import { requireString, optionalString } from "../../utils/db-helpers";
import { assertPhotoMediaOwned } from "../../utils/media-helpers";
import {
  generateId,
  parseOccurredAt,
  parseVisibility,
  parseRequiredStringArray,
  upsertTags,
  loadEntryRelations,
} from "../../utils/entry-helpers";
import { assertTripOwnershipIfPresent } from "../../utils/trip-helpers";

type DbClient = ReturnType<typeof getDb>;

async function insertEntryPhotos(
  database: DbClient,
  entryId: string,
  mediaIds: string[],
): Promise<void> {
  if (mediaIds.length === 0) {
    return;
  }
  const photoRows = mediaIds.map((mediaId, index) => ({
    id: generateId(),
    entryId,
    mediaId,
    sortOrder: index,
  }));
  await database.insert(entryPhotos).values(photoRows);
}

async function insertEntryTags(
  database: DbClient,
  entryId: string,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) {
    return;
  }
  const tagRows = tagIds.map((tagId) => ({ entryId, tagId }));
  await database.insert(entryTags).values(tagRows);
}

export default defineEventHandler(async (event) => {
  const userId = await ensureUser(event);
  const database = getDb();
  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>;

  requireString(body?.title, "title");
  const title = (body.title as string).trim();
  if (title === "") {
    throw createError({
      statusCode: 400,
      statusMessage: "title must not be empty",
    });
  }

  const bodyText = optionalString(body?.body, "body");
  const tripId = optionalString(body?.tripId, "tripId");
  const placeId = optionalString(body?.placeId, "placeId");
  const weather = optionalString(body?.weather, "weather");
  const occurredAt = parseOccurredAt(body?.occurredAt);
  const visibility = parseVisibility(body?.visibility);
  const tagNames = parseRequiredStringArray(body?.tags, "tags");
  const photoMediaIds = parseRequiredStringArray(
    body?.photoMediaIds,
    "photoMediaIds",
  );

  // After synchronous validation (malformed body 400s without a DB hit),
  // before the insert (never attach an entry to a trip the caller doesn't own).
  await assertTripOwnershipIfPresent(event, tripId);

  // Reject foreign/nonexistent photo media before writing anything: a media id
  // the caller doesn't own would otherwise be attached to this entry.
  await assertPhotoMediaOwned(database, userId, photoMediaIds);

  const entryId = generateId();

  // Not wrapped in database.transaction(): the app's drizzle client is
  // configured with the neon-http driver everywhere (see server/db/index.ts),
  // which has no transaction support (it issues each query as its own HTTP
  // call). Write steps run sequentially instead; upsertTags is already
  // idempotent (insert ... onConflictDoUpdate) so a partial failure there is
  // safe to retry. If a later write step still fails, the entry row is
  // deleted below (its entryTags/entryPhotos foreign keys are ON DELETE
  // CASCADE, so those rows are cleaned up too) so a 500 never leaves an
  // orphaned entry behind. The relations load that follows is a read, not a
  // write, so it is deliberately outside this try/catch: a transient read
  // failure must not delete an entry whose writes already committed.
  const inserted = await database
    .insert(entries)
    .values({
      id: entryId,
      userId,
      title,
      body: bodyText,
      tripId,
      placeId,
      weather,
      occurredAt,
      visibility,
    })
    .returning();

  try {
    const tagIds = await upsertTags(database, tagNames);
    await insertEntryPhotos(database, entryId, photoMediaIds);
    await insertEntryTags(database, entryId, tagIds);
  } catch (error) {
    try {
      await database.delete(entries).where(eq(entries.id, entryId));
    } catch (cleanupError) {
      // Cleanup best-effort only: surface the original failure below, not a
      // secondary error from the cleanup delete itself.
      console.error(
        "entries.post: cleanup after partial write failed",
        cleanupError,
      );
    }
    throw error;
  }

  const relations = await loadEntryRelations(database, entryId);
  return { ...inserted[0], ...relations };
});
