import type { BatchItem } from "drizzle-orm/batch";
import { ensureUser } from "../../utils/auth";
import { getDb, runBatch } from "../../db/index";
import { entries, entryPhotos, entryTags } from "../../db/schema";
import { requireString, optionalString } from "../../utils/db-helpers";
import { assertPhotoMediaOwned } from "../../utils/media-helpers";
import { assertPlaceOwnedIfPresent } from "../../utils/place-helpers";
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
type Entry = typeof entries.$inferSelect;
type NewEntry = typeof entries.$inferInsert;

function buildEntryPhotoRows(entryId: string, mediaIds: string[]) {
  return mediaIds.map((mediaId, index) => ({
    id: generateId(),
    entryId,
    mediaId,
    sortOrder: index,
  }));
}

function buildEntryTagRows(entryId: string, tagIds: string[]) {
  return tagIds.map((tagId) => ({ entryId, tagId }));
}

// Writes the entry row plus its photo and tag links as ONE atomic
// database.batch() call — the neon-http driver's real BEGIN/COMMIT unit (see
// server/db/index.ts). `input.id`, `tagIds`, and `photoMediaIds` are all
// resolved in JS before this runs (tagIds comes from upsertTags, a separate
// read/write round trip that must finish first because its result feeds the
// entryTags insert values), so none of these statements needs to read another
// statement's result within the batch. A failure anywhere in the batch (e.g.
// a bad photoMediaId slipping past assertPhotoMediaOwned) rolls the whole
// thing back atomically, so there is no orphaned entry row to delete by hand
// — replacing the old insert-then-try/catch-delete compensation entirely.
async function insertEntryWithRelations(
  database: DbClient,
  input: NewEntry & { id: string },
  tagIds: string[],
  photoMediaIds: string[],
): Promise<Entry> {
  const statements: BatchItem<"pg">[] = [
    database.insert(entries).values(input).returning(),
  ];

  if (photoMediaIds.length > 0) {
    statements.push(
      database
        .insert(entryPhotos)
        .values(buildEntryPhotoRows(input.id, photoMediaIds)),
    );
  }

  if (tagIds.length > 0) {
    statements.push(
      database.insert(entryTags).values(buildEntryTagRows(input.id, tagIds)),
    );
  }

  const [insertedRows] = (await runBatch(database, statements)) as [Entry[]];

  const insertedEntry = insertedRows[0];
  if (!insertedEntry) {
    throw new Error(`Failed to insert entry ${input.id}`);
  }
  return insertedEntry;
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

  // Reject a foreign/nonexistent place before writing: a placeId the caller
  // doesn't own would otherwise dangle this entry off another user's place.
  await assertPlaceOwnedIfPresent(database, userId, placeId);

  const entryId = generateId();

  // Resolved before the write batch: upsertTags does its own read/write round
  // trip(s) per tag name, so its result (tagIds) is a known value by the time
  // insertEntryWithRelations builds its batch, not something read mid-batch.
  const tagIds = await upsertTags(database, tagNames);

  const insertedEntry = await insertEntryWithRelations(
    database,
    {
      id: entryId,
      userId,
      title,
      body: bodyText,
      tripId,
      placeId,
      weather,
      occurredAt,
      visibility,
    },
    tagIds,
    photoMediaIds,
  );

  const relations = await loadEntryRelations(database, entryId);
  return { ...insertedEntry, ...relations };
});
