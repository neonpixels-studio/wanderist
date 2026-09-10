import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  loadOwnedOrThrow,
  optionalString,
  requireRouterParam,
} from "../../utils/db-helpers";
import { getDb } from "../../db/index";
import { entries, entryPhotos, entryTags } from "../../db/schema";
import { deleteMediaIfUnreferenced } from "../../utils/coverImageCleanup";
import { assertPhotoMediaOwned } from "../../utils/media-helpers";
import { assertPlaceOwnedIfPresent } from "../../utils/place-helpers";
import { assertTripOwnershipIfPresent } from "../../utils/trip-helpers";
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

// Builds (but does not run) the delete-then-insert pair that replaces an
// entry's tag links. tagIds is already resolved (upsertTags is a separate
// read/write round trip whose result these statements need), so the delete
// and insert values are both fully known up front and can run together in the
// caller's atomic database.batch() — a real BEGIN/COMMIT on the neon-http
// driver (see server/db/index.ts) — instead of as two independent HTTP calls
// with a partial-replace gap between them.
function buildTagReplaceStatements(
  database: DbClient,
  entryId: string,
  tagIds: string[],
): BatchItem<"pg">[] {
  const statements: BatchItem<"pg">[] = [
    database.delete(entryTags).where(eq(entryTags.entryId, entryId)),
  ];

  if (tagIds.length > 0) {
    statements.push(
      database
        .insert(entryTags)
        .values(tagIds.map((tagId) => ({ entryId, tagId }))),
    );
  }

  return statements;
}

// Same shape as buildTagReplaceStatements, for the entry's photo links.
function buildPhotoReplaceStatements(
  database: DbClient,
  entryId: string,
  mediaIds: string[],
): BatchItem<"pg">[] {
  const statements: BatchItem<"pg">[] = [
    database.delete(entryPhotos).where(eq(entryPhotos.entryId, entryId)),
  ];

  if (mediaIds.length > 0) {
    statements.push(
      database.insert(entryPhotos).values(
        mediaIds.map((mediaId, index) => ({
          id: generateId(),
          entryId,
          mediaId,
          sortOrder: index,
        })),
      ),
    );
  }

  return statements;
}

// Captured BEFORE the replace: once the photo-replace batch deletes the old
// rows there is nothing left to tell us which media they pointed at.
async function collectEntryPhotoMediaIds(
  database: DbClient,
  entryId: string,
): Promise<string[]> {
  const rows = await database
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

// Runs after the entry's photo rows are replaced and committed, so the
// reference check does not see the row that just released the media. Cleanups
// run concurrently and each swallows its own error, so one
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

interface EntryWritePlan {
  updates: EntryUpdates;
  hasScalarUpdates: boolean;
  tagNames: string[] | undefined;
  photoMediaIds: string[] | undefined;
}

// Runs the entry's scalar update plus its tag/photo replaces as ONE atomic
// database.batch() call — the neon-http driver's real BEGIN/COMMIT unit (see
// server/db/index.ts). `updates`, `tagIds` (resolved via upsertTags — a
// separate read/write round trip whose result the entryTags insert needs),
// and `photoMediaIds` are all known in JS before the batch is built, so none
// of these statements needs to read another statement's result within the
// batch. This closes the gap the old sequential-writes comment used to
// describe: a failure used to be able to leave that entry's tags or photos
// half-replaced with no rollback; now the whole batch rolls back atomically.
// `previousMediaIds` is a read, not a write, and must run before the photo
// replace's delete or there would be nothing left to report on. Returns the
// updated entry plus the photo media the patch released so the caller can
// clean it up after the batch commits.
async function applyEntryWrites(
  database: DbClient,
  id: string,
  plan: EntryWritePlan,
): Promise<{ updated: Entry | undefined; removedMediaIds: string[] }> {
  const { updates, hasScalarUpdates, tagNames, photoMediaIds } = plan;

  const tagIds =
    tagNames !== undefined ? await upsertTags(database, tagNames) : undefined;

  const previousMediaIds =
    photoMediaIds !== undefined
      ? await collectEntryPhotoMediaIds(database, id)
      : undefined;

  const statements: BatchItem<"pg">[] = [];
  if (hasScalarUpdates) {
    statements.push(
      database.update(entries).set(updates).where(eq(entries.id, id)),
    );
  }
  if (tagIds !== undefined) {
    statements.push(...buildTagReplaceStatements(database, id, tagIds));
  }
  if (photoMediaIds !== undefined) {
    statements.push(
      ...buildPhotoReplaceStatements(database, id, photoMediaIds),
    );
  }

  if (statements.length > 0) {
    await database.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
  }

  const removedMediaIds =
    photoMediaIds !== undefined
      ? mediaIdsNoLongerReferenced(previousMediaIds ?? [], photoMediaIds)
      : [];

  // Always re-read rather than relying on the scalar update's own
  // `.returning()`: keeping that statement's result out of the batch return
  // value avoids threading a positional index through a variable-length
  // statement list for what both handlers already needed as a fallback (see
  // the previous `if (!updated)` branch this replaces) when there were no
  // scalar updates to return from.
  const rows = await database.select().from(entries).where(eq(entries.id, id));

  return { updated: rows[0], removedMediaIds };
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

  // After synchronous validation (malformed body 400s without a DB hit),
  // before any write (never move an entry to a trip the caller doesn't own). A
  // no-op when the patch does not touch tripId.
  await assertTripOwnershipIfPresent(event, tripId);

  // Reject foreign/nonexistent photo media before any write: a media id the
  // entry owner doesn't own would otherwise replace the entry's photos.
  if (photoMediaIds !== undefined) {
    await assertPhotoMediaOwned(database, entry.userId, photoMediaIds);
  }

  // Reject a foreign/nonexistent place before any write: a placeId the entry
  // owner doesn't own would otherwise re-point this entry at another user's
  // place. A no-op when the patch does not touch placeId.
  await assertPlaceOwnedIfPresent(database, entry.userId, placeId);

  const { updated, removedMediaIds } = await applyEntryWrites(database, id, {
    updates,
    hasScalarUpdates,
    tagNames,
    photoMediaIds,
  });

  // Cleanup runs after the photo replace commits (so deleteMediaIfUnreferenced
  // sees the new photo rows and never deletes media the replace kept) but before
  // the relations read below: the read is not a write, so a transient read
  // failure must not skip cleanup and leak the released media rows. Ordering is
  // safe — deleteMediaIfUnreferenced re-checks live references, so running it
  // ahead of the read cannot change what the response reports.
  await cleanupReplacedPhotoMedia(database, entry.userId, id, removedMediaIds);

  const relations = await loadEntryRelations(database, id);
  return { ...updated, ...relations };
});
