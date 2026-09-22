import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb, runBatch } from "../db/index";
import {
  entries,
  entryLikes,
  guideLikes,
  guides,
  VISIBILITY,
} from "../db/schema";

type Database = ReturnType<typeof getDb>;

/**
 * A likeable parent row exposes the columns the access gate and count-repair
 * need. Both `entries` and `guides` satisfy this.
 */
interface LikeableRow {
  userId: string;
  visibility: string;
  likeCount: number;
}

/**
 * Describes one likeable content type so a single set of like operations can
 * serve both entries and guides (rule of three: like, unlike, and both read
 * paths would otherwise duplicate the same query shape four times per type).
 *
 * `likeContentColumn`/`likeUserColumn` are the join-table columns; `contentKey`
 * is the matching Drizzle insert key. The user column and denormalised-count
 * column are always named `user_id`/`like_count`, so they are hardcoded in the
 * helpers rather than parameterised here.
 */
export interface LikeableConfig {
  likeTable: PgTable;
  likeContentColumn: PgColumn;
  likeUserColumn: PgColumn;
  // The join table's content-fk insert key. A closed union (not `string`) so a
  // typo or a config pointing at the wrong column fails to compile rather than
  // at runtime with a NOT NULL violation.
  contentKey: "entryId" | "guideId";
  contentTable: PgTable;
  contentIdColumn: PgColumn;
}

export const ENTRY_LIKEABLE: LikeableConfig = {
  likeTable: entryLikes,
  likeContentColumn: entryLikes.entryId,
  likeUserColumn: entryLikes.userId,
  contentKey: "entryId",
  contentTable: entries,
  contentIdColumn: entries.id,
};

export const GUIDE_LIKEABLE: LikeableConfig = {
  likeTable: guideLikes,
  likeContentColumn: guideLikes.guideId,
  likeUserColumn: guideLikes.userId,
  contentKey: "guideId",
  contentTable: guides,
  contentIdColumn: guides.id,
};

/**
 * Loads the parent content row and authorises the like. Throws 404 when the
 * content does not exist OR when it is private and not owned by `userId` — the
 * same 404 in both cases so liking a guessed id can't confirm the existence of
 * another user's private content or leak its body into the response. Called
 * before a like/unlike so a bad id returns a clean 404 instead of surfacing a
 * foreign-key violation (or, for unlike, silently doing nothing).
 */
export async function loadLikeableOrThrow<T extends LikeableRow>(
  database: Database,
  config: LikeableConfig,
  contentId: string,
  userId: string,
): Promise<T> {
  const rows = await database
    .select()
    .from(config.contentTable)
    .where(eq(config.contentIdColumn, contentId))
    .limit(1);

  const row = rows[0] as T | undefined;

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  if (row.visibility !== VISIBILITY.PUBLIC && row.userId !== userId) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  return row;
}

/**
 * Builds (but does not run) the count-repair UPDATE: recomputes the
 * denormalised like count from the join table and writes it back to the
 * parent row, every like/unlike deriving it from a COUNT rather than a
 * `+ 1`/`- 1` so it self-corrects instead of compounding drift. Split out
 * from running it so `likeContent`/`unlikeContent` can pair this statement
 * with their like-row write in one atomic `database.batch()` call (see
 * server/db/index.ts) instead of two independent HTTP round trips with a
 * committed-write-then-failing-repair gap between them.
 */
function buildRepairLikeCountStatement(
  database: Database,
  config: LikeableConfig,
  contentId: string,
): BatchItem<"pg"> {
  return database
    .update(config.contentTable)
    .set({
      likeCount: sql`(
        SELECT count(*) FROM ${config.likeTable}
        WHERE ${config.likeContentColumn} = ${contentId}
      )`,
    })
    .where(eq(config.contentIdColumn, contentId))
    .returning();
}

// Positions within the like/unlike batch; the repair statement is always last.
const LIKE_WRITE_STATEMENT_INDEX = 0;
const REPAIR_STATEMENT_INDEX = 1;

/**
 * Reads one statement's `RETURNING` rows out of a batch's results at
 * `statementIndex`. `RETURNING` always produces an array, so a non-array
 * result means the driver's response shape changed underneath this code —
 * that should fail loudly (500) rather than being silently misread as an
 * empty or missing result.
 */
function readReturningRows(
  batchResults: unknown[],
  statementIndex: number,
): unknown[] {
  const result = batchResults[statementIndex];

  if (!Array.isArray(result)) {
    throw createError({
      statusCode: 500,
      statusMessage: "Unexpected batch result shape",
    });
  }

  return result;
}

/**
 * Pulls the count-repair UPDATE's `RETURNING` row out of a batch's results.
 * Throws 404 when the row was never found — the unlike path, where the
 * content row vanished between `loadLikeableOrThrow` and this update.
 */
function extractRepairedRow<T extends Record<string, unknown>>(
  batchResults: unknown[],
): T {
  const row = readReturningRows(batchResults, REPAIR_STATEMENT_INDEX)[0] as
    T | undefined;

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  return row;
}

export interface LikeResult<T> {
  content: T;
  // Whether this call inserted a new like row. False when the user had already
  // liked the content and the ON CONFLICT DO NOTHING was a no-op. Lets callers
  // notify the author exactly once instead of on every repeated like.
  created: boolean;
}

/**
 * Records a like idempotently (ON CONFLICT DO NOTHING on the composite PK) and
 * returns the parent row with its repaired count plus whether this call created
 * a new like. Safe to call repeatedly for the same (content, user) pair — the
 * count stays at exactly one and `created` is false after the first like.
 * Batches the insert with the count-repair — see
 * `buildRepairLikeCountStatement`'s docstring for why.
 */
export async function likeContent<T extends Record<string, unknown>>(
  database: Database,
  config: LikeableConfig,
  contentId: string,
  userId: string,
): Promise<LikeResult<T>> {
  const insertStatement = database
    .insert(config.likeTable)
    .values({ [config.contentKey]: contentId, userId })
    .onConflictDoNothing()
    .returning({ userId: config.likeUserColumn });

  const repairStatement = buildRepairLikeCountStatement(
    database,
    config,
    contentId,
  );

  const batchResults = await runBatch(database, [
    insertStatement,
    repairStatement,
  ]);

  const inserted = readReturningRows(batchResults, LIKE_WRITE_STATEMENT_INDEX);
  const content = extractRepairedRow<T>(batchResults);

  return { content, created: inserted.length > 0 };
}

/**
 * Removes a like (no-op if it was never there) and returns the parent row with
 * its repaired count. Batches the delete with the count-repair — see
 * `buildRepairLikeCountStatement`'s docstring for why.
 */
export async function unlikeContent<T extends Record<string, unknown>>(
  database: Database,
  config: LikeableConfig,
  contentId: string,
  userId: string,
): Promise<T> {
  const deleteStatement = database
    .delete(config.likeTable)
    .where(
      and(
        eq(config.likeContentColumn, contentId),
        eq(config.likeUserColumn, userId),
      ),
    );

  const repairStatement = buildRepairLikeCountStatement(
    database,
    config,
    contentId,
  );

  const batchResults = await runBatch(database, [
    deleteStatement,
    repairStatement,
  ]);

  return extractRepairedRow<T>(batchResults);
}

/**
 * Whether `userId` has liked a single piece of content. Used by single-item
 * read paths to set `likedByCurrentUser`.
 */
export async function hasLiked(
  database: Database,
  config: LikeableConfig,
  contentId: string,
  userId: string,
): Promise<boolean> {
  const rows = await database
    .select({ contentId: config.likeContentColumn })
    .from(config.likeTable)
    .where(
      and(
        eq(config.likeContentColumn, contentId),
        eq(config.likeUserColumn, userId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * The subset of `contentIds` that `userId` has liked, as a Set for O(1)
 * membership. One batched query backs the list read paths so they set
 * `likedByCurrentUser` per row without an N+1.
 */
export async function likedContentIds(
  database: Database,
  config: LikeableConfig,
  contentIds: string[],
  userId: string,
): Promise<Set<string>> {
  if (contentIds.length === 0) {
    return new Set();
  }

  const rows = await database
    .select({ contentId: config.likeContentColumn })
    .from(config.likeTable)
    .where(
      and(
        inArray(config.likeContentColumn, contentIds),
        eq(config.likeUserColumn, userId),
      ),
    );

  return new Set(rows.map((row) => row.contentId));
}
