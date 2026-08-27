/**
 * POST /api/connections/instagram/import
 *
 * Pulls the user's recent geotagged Instagram media, fetches image bytes from
 * the Instagram CDN, stores them via the media-storage-and-uploads layer, and
 * creates journal entries linked to the matching place for each photo.
 *
 * Idempotent: items whose Instagram media ID already exists in `media.source_id`
 * for this user are skipped rather than duplicated.
 *
 * Place deduplication: photos taken at the same location (name + coordinates)
 * reuse the existing `places` row rather than inserting duplicates.
 *
 * Bounded per run: a first-time account can hold ~500 geotagged photos, and
 * importing each is expensive (CDN fetch + image processing + DB transaction +
 * blob writes), so an unbounded run overruns the Netlify function timeout and
 * commits partial work. Each run imports at most
 * INSTAGRAM_IMPORT_MAX_ITEMS_PER_RUN new photos and stops before the wall-time
 * budget is spent, reporting `hasMore` and how many items are `remaining` so
 * the client can call again to resume. No separate cursor is persisted; the
 * idempotent `media.source_id` set is the cursor: already-imported items are
 * skipped, so the next run naturally picks up where this one stopped.
 *
 * Returns a summary:
 *   { imported, skipped, errors, hasMore, remaining }
 */

import { eq, and, inArray } from "drizzle-orm";
import { ensureUser } from "../../../utils/auth";
import { getDb } from "../../../db/index";
import {
  connectedAccounts,
  media,
  entries,
  places,
  entryPhotos,
  CONNECTED_ACCOUNT_PROVIDER,
  MEDIA_SOURCE,
  VISIBILITY,
} from "../../../db/schema";
import {
  processMediaImage,
  storeMediaBlobs,
} from "../../../utils/mediaPipeline";
import {
  fetchInstagramMedia,
  fetchInstagramImage,
  filterGeotaggedMedia,
  INSTAGRAM_IMPORT_MAX_ITEMS_PER_RUN,
  INSTAGRAM_IMPORT_TIME_BUDGET_MS,
  type InstagramMediaItem,
} from "../../../utils/instagramClient";
import {
  ensureFreshInstagramToken,
  InstagramTokenExpiredError,
  type StoredInstagramToken,
} from "../../../utils/instagramToken";
import { assertInstagramSyncAllowed } from "../../../utils/planLimits";

type DbClient = ReturnType<typeof getDb>;

// Refresh-on-use: renews and persists the token before it lapses so an active
// importer's connection self-heals without waiting for the scheduled job. An
// already-expired token Instagram refuses to refresh becomes a 422 "reconnect"
// response rather than an opaque 500.
async function resolveFreshAccessToken(
  database: DbClient,
  userId: string,
  stored: StoredInstagramToken,
): Promise<string> {
  try {
    return await ensureFreshInstagramToken(database, userId, stored);
  } catch (error) {
    if (error instanceof InstagramTokenExpiredError) {
      throw createError({
        statusCode: 422,
        statusMessage: "Instagram connection expired, please reconnect",
      });
    }
    throw error;
  }
}

function buildEntryTitle(item: InstagramMediaItem): string {
  if (item.caption) {
    return item.caption.slice(0, 100);
  }
  return `Photo from ${item.location!.name}`;
}

function detectContentType(mediaUrl: string): string {
  const pathname = new URL(mediaUrl).pathname.toLowerCase();
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

async function fetchAlreadyImportedIds(
  userId: string,
  instagramIds: string[],
): Promise<Set<string>> {
  if (instagramIds.length === 0) {
    return new Set();
  }
  const database = getDb();
  const rows = await database
    .select({ sourceId: media.sourceId })
    .from(media)
    .where(
      and(
        eq(media.userId, userId),
        eq(media.source, MEDIA_SOURCE.INSTAGRAM),
        inArray(media.sourceId, instagramIds),
      ),
    );
  return new Set(rows.map((row) => row.sourceId).filter(Boolean) as string[]);
}

async function resolveOrCreatePlace(
  database: DbClient,
  userId: string,
  item: InstagramMediaItem,
): Promise<string> {
  const locationName = item.location!.name;
  const latitude = item.location!.latitude;
  const longitude = item.location!.longitude;

  const existingRows = await database
    .select({ id: places.id })
    .from(places)
    .where(
      and(
        eq(places.userId, userId),
        eq(places.name, locationName),
        eq(places.latitude, latitude),
        eq(places.longitude, longitude),
      ),
    )
    .limit(1);

  if (existingRows[0]) {
    return existingRows[0].id;
  }

  const [placeRow] = await database
    .insert(places)
    .values({
      id: crypto.randomUUID(),
      userId,
      name: locationName,
      latitude,
      longitude,
    })
    .returning({ id: places.id });

  if (!placeRow) {
    throw new Error(
      `Failed to insert place record for Instagram item ${item.id}`,
    );
  }
  return placeRow.id;
}

// Runs one best-effort rollback delete in isolation so a failure in an earlier
// delete cannot suppress a later one — the media delete is the important one
// (its unique index is the idempotency guard, so a leftover media row makes the
// item unimportable forever), and it must run even if the entry delete throws.
// Takes a thunk (not an already-started promise) so both deletes are not in
// flight at once — a second query rejecting before the first is awaited would
// otherwise surface as an unhandled rejection. Returns whether the delete
// succeeded so the caller can surface a leak loudly rather than swallowing it.
async function deleteQuietly(
  runDelete: () => Promise<unknown>,
  description: string,
): Promise<boolean> {
  try {
    await runDelete();
    return true;
  } catch (cleanupError) {
    console.error(
      `instagram import: rollback delete failed for ${description}`,
      cleanupError,
    );
    return false;
  }
}

interface RollbackResult {
  entryDeleted: boolean;
  mediaDeleted: boolean;
}

// Best-effort rollback for a partially-written import. The app's drizzle client
// uses the neon-http driver (see server/db/index.ts), which has no interactive
// transactions, so a failed import is undone by hand: deleting the entry cascades
// its entryPhotos, and deleting the media row cascades any entryPhotos that hung
// off it (both FKs are ON DELETE CASCADE). Deletes are id-scoped (and owner-scoped
// as defence in depth), so deleting a row that was never written — or a race
// loser's row that lost the unique-index insert — is a harmless no-op that cannot
// touch the race winner's differently-keyed row. A newly-created place row is
// intentionally left: it is deduplicated (matched on name + coordinates) and
// reused by the next import run for the same location, so deleting it risks
// nulling a sibling entry's placeId. Returns which deletes succeeded.
async function rollbackPartialImport(
  database: DbClient,
  userId: string,
  entryId: string,
  mediaId: string,
): Promise<RollbackResult> {
  const entryDeleted = await deleteQuietly(
    () =>
      database
        .delete(entries)
        .where(and(eq(entries.id, entryId), eq(entries.userId, userId))),
    `entry ${entryId}`,
  );
  const mediaDeleted = await deleteQuietly(
    () =>
      database
        .delete(media)
        .where(and(eq(media.id, mediaId), eq(media.userId, userId))),
    `media ${mediaId}`,
  );
  return { entryDeleted, mediaDeleted };
}

// Rolls back a partially-written import, then always throws. When a rollback
// delete itself failed we throw a message that names the leak so it lands in the
// per-item errors[] (and thus in front of the user) instead of being reported as
// a plain retryable failure: a leaked media row makes the item skip forever, and
// a leaked entry makes the next re-import duplicate it.
async function rollbackOrThrow(
  database: DbClient,
  userId: string,
  entryId: string,
  mediaId: string,
  originalError: unknown,
): Promise<never> {
  const { entryDeleted, mediaDeleted } = await rollbackPartialImport(
    database,
    userId,
    entryId,
    mediaId,
  );
  const baseMessage =
    originalError instanceof Error
      ? originalError.message
      : String(originalError);
  if (!mediaDeleted) {
    throw new Error(
      `${baseMessage} (rollback failed: media row ${mediaId} leaked; the item will be skipped on future runs and needs manual cleanup)`,
    );
  }
  if (!entryDeleted) {
    throw new Error(
      `${baseMessage} (rollback failed: entry ${entryId} leaked; a re-import will duplicate it)`,
    );
  }
  throw originalError;
}

interface MediaInsertInput {
  mediaId: string;
  storageKey: string;
  contentType: string;
  dimensions: { width: number; height: number } | null;
}

// Writes the media, place, entry, and entryPhotos rows for one imported photo.
// The neon-http driver has no interactive transactions (see server/db/index.ts),
// so the rows are written sequentially and undone by hand on failure rather than
// rolled back. The media row is inserted FIRST because it carries the
// (user_id, source, source_id) unique index: a concurrent race for the same item
// loses at that insert, and rollbackOrThrow's id-scoped delete of the loser's own
// (never-committed or self-owned) row is a no-op that never touches the winner.
// Wrapping the whole sequence means even a media insert that commits but then
// fails on the HTTP response (timeout/502) is rolled back rather than left as an
// unreferenced, permanently-skipped row. A place created before a later failure
// is deliberately left behind: it is deduplicated by name + coordinates and
// reused by the next run, so it is harmless (see rollbackPartialImport).
async function persistImportedPhotoRows(
  database: DbClient,
  userId: string,
  item: InstagramMediaItem,
  mediaInput: MediaInsertInput,
): Promise<{ entryId: string }> {
  const entryId = crypto.randomUUID();

  try {
    const [mediaRow] = await database
      .insert(media)
      .values({
        id: mediaInput.mediaId,
        userId,
        url: mediaInput.storageKey,
        contentType: mediaInput.contentType,
        width: mediaInput.dimensions?.width ?? null,
        height: mediaInput.dimensions?.height ?? null,
        source: MEDIA_SOURCE.INSTAGRAM,
        sourceId: item.id,
      })
      .returning({ id: media.id });

    if (!mediaRow) {
      throw new Error(
        `Failed to insert media record for Instagram item ${item.id}`,
      );
    }

    const placeId = await resolveOrCreatePlace(database, userId, item);

    const [entryRow] = await database
      .insert(entries)
      .values({
        id: entryId,
        userId,
        placeId,
        title: buildEntryTitle(item),
        body: item.caption ?? null,
        occurredAt: new Date(item.timestamp),
        visibility: VISIBILITY.PRIVATE,
      })
      .returning({ id: entries.id });

    if (!entryRow) {
      throw new Error(`Failed to insert entry for Instagram item ${item.id}`);
    }

    await database.insert(entryPhotos).values({
      id: crypto.randomUUID(),
      entryId: entryRow.id,
      mediaId: mediaRow.id,
      sortOrder: 0,
    });
  } catch (error) {
    await rollbackOrThrow(database, userId, entryId, mediaInput.mediaId, error);
  }

  return { entryId };
}

async function importSinglePhoto(
  userId: string,
  item: InstagramMediaItem,
): Promise<void> {
  const database = getDb();
  const imageBuffer = await fetchInstagramImage(item.media_url);
  const contentType = detectContentType(item.media_url);
  const mediaId = crypto.randomUUID();
  const storageKey = `${userId}/${mediaId}`;

  // Probe dimensions and generate the thumbnail before writing any row so
  // width/height land on the media row in the same insert the upload path uses.
  // Best-effort: a bad image yields null dimensions and no thumbnail without
  // blocking the import.
  const { dimensions, thumbnailBuffer } = await processMediaImage(imageBuffer);

  // Commit the DB rows first, then write the blobs.
  const { entryId } = await persistImportedPhotoRows(database, userId, item, {
    mediaId,
    storageKey,
    contentType,
    dimensions,
  });

  // The original blob store is the only remaining write. If it fails, the rows
  // are already committed and the media row's URL would point at a blob that was
  // never written; because source_id is in the table, the item would otherwise be
  // skipped on every future run — permanently broken and un-retryable. So roll the
  // rows back and rethrow, which frees source_id and lets the next run retry.
  // Tradeoff: if putMediaBlob actually landed the object and then failed on the
  // response, rolling the rows back orphans that blob (nothing references it); an
  // orphaned blob is a storage cost, far cheaper than a permanently-stuck entry,
  // and is preferable to the un-retryable row. (storeMediaBlobs only throws on the
  // original blob; a thumbnail-store failure returns null, handled below.)
  let thumbnailKey: string | null = null;
  try {
    thumbnailKey = await storeMediaBlobs(
      storageKey,
      imageBuffer,
      thumbnailBuffer,
      contentType,
    );
  } catch (error) {
    await rollbackOrThrow(database, userId, entryId, mediaId, error);
  }

  // Surface the best-effort thumbnail gap rather than swallowing it: the row is
  // already committed and will be skipped on re-import, so a missing thumbnail
  // is otherwise invisible and un-backfillable.
  if (!thumbnailKey) {
    console.warn(
      `instagram import: no thumbnail stored for media ${mediaId} (item ${item.id})`,
    );
  }
}

// The POST response shape. The client mirrors this as InstagramImportResult in
// app/composables/useConnections.ts; annotating the handler's return here makes
// a server-side rename or dropped field a compile error rather than a runtime
// surprise in the settings alert copy.
interface ImportRunSummary {
  imported: number;
  skipped: number;
  errors: string[];
  hasMore: boolean;
  remaining: number;
}

interface BatchResult {
  imported: number;
  errors: string[];
  // How many items the loop actually attempted before its count/time budget was
  // spent; the rest of `items` is deferred to the next run.
  processed: number;
  // True when the loop stopped because the wall-time budget ran out (rather than
  // the count cap or reaching the end). Lets the caller advertise a resume even
  // when the deadline hit before anything was imported.
  stoppedOnDeadline: boolean;
}

// Imports items one at a time, stopping before it starts an item once either
// the per-run count cap or the wall-time budget is spent. Bounding on both
// keeps a run under the function timeout even when per-item cost is uneven.
async function importBatch(
  userId: string,
  items: InstagramMediaItem[],
  maxItems: number,
  deadlineAt: number,
): Promise<BatchResult> {
  let imported = 0;
  let processed = 0;
  let stoppedOnDeadline = false;
  const errors: string[] = [];

  for (const item of items) {
    if (processed >= maxItems) {
      break;
    }
    // Always attempt at least one item per run (`processed > 0` guard) so a run
    // that entered with its time budget already spent — e.g. a slow page walk
    // ate it — still makes forward progress instead of returning zero-imported
    // and looping the user on "run again" forever.
    if (processed > 0 && Date.now() >= deadlineAt) {
      stoppedOnDeadline = true;
      break;
    }
    processed += 1;
    try {
      await importSinglePhoto(userId, item);
      imported += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Item ${item.id}: ${message}`);
    }
  }

  return { imported, errors, processed, stoppedOnDeadline };
}

export default defineEventHandler(async (event): Promise<ImportRunSummary> => {
  // Anchor the wall-time budget at handler entry so it covers the whole
  // invocation — the page walk and dedupe query included — not just the import
  // loop. Otherwise a slow page walk plus a full loop could still overrun the
  // function timeout.
  const deadlineAt = Date.now() + INSTAGRAM_IMPORT_TIME_BUDGET_MS;

  const userId = await ensureUser(event);
  // No separate per-item photo-storage cap here: Instagram sync itself is
  // gated to Wanderer/Nomad (see assertInstagramSyncAllowed), and both of
  // those plans already have unlimited photo storage (see PLAN_LIMITS), so a
  // user who reaches this handler can never be photo-limited in practice.
  await assertInstagramSyncAllowed(userId);

  const database = getDb();

  const connectionRows = await database
    .select({
      externalId: connectedAccounts.externalId,
      accessToken: connectedAccounts.accessToken,
      expiresAt: connectedAccounts.expiresAt,
    })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.provider, CONNECTED_ACCOUNT_PROVIDER.INSTAGRAM),
      ),
    )
    .limit(1);

  const connection = connectionRows[0];
  if (!connection || !connection.accessToken) {
    throw createError({
      statusCode: 422,
      statusMessage: "Instagram account not connected",
    });
  }

  const accessToken = await resolveFreshAccessToken(database, userId, {
    externalId: connection.externalId,
    accessToken: connection.accessToken,
    expiresAt: connection.expiresAt,
  });
  const mediaResponse = await fetchInstagramMedia(accessToken);
  const geotagged = filterGeotaggedMedia(mediaResponse.data);

  const instagramIds = geotagged.map((item) => item.id);
  const alreadyImportedIds = await fetchAlreadyImportedIds(
    userId,
    instagramIds,
  );

  const pendingItems = geotagged.filter(
    (item) => !alreadyImportedIds.has(item.id),
  );
  const skipped = geotagged.length - pendingItems.length;

  // Bound the expensive per-item work so the run stays under the function
  // timeout; the overflow resumes on the next call (already-imported items are
  // skipped above, so no cursor state is needed to know where to continue).
  const { imported, errors, processed, stoppedOnDeadline } = await importBatch(
    userId,
    pendingItems,
    INSTAGRAM_IMPORT_MAX_ITEMS_PER_RUN,
    deadlineAt,
  );

  // `remaining` is the retry count shown to the user: every item not yet
  // successfully imported, including this run's failures (a failed item is never
  // written to media.source_id, so it stays pending and is re-attempted).
  const remaining = pendingItems.length - imported;

  // `deferred` is the count the loop never even attempted (cut off by the count
  // cap or the time budget). Gate the resume on that, not on `remaining`: if
  // every pending item was attempted and only failures are left, re-running just
  // re-fails, so don't advertise phantom deferred work. The `imported > 0`
  // clause additionally rules out the degenerate case where the whole attempted
  // batch failed (zero progress), and `stoppedOnDeadline` keeps a run that
  // imported nothing only because it ran out of time from looking complete.
  // None of this skips a permanently-broken item sitting among good ones — that
  // item is re-fetched every run until it succeeds or a human intervenes;
  // draining past it needs a durable per-source_id failure marker (follow-up).
  const deferred = pendingItems.length - processed;
  const hasMore = deferred > 0 && (imported > 0 || stoppedOnDeadline);

  return { imported, skipped, errors, hasMore, remaining };
});
