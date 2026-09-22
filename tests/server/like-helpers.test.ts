import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "./test-utils";

stubNitroGlobals();

// Spy on eq so the count-repair UPDATE's WHERE scope can be asserted (a dropped
// or broadened WHERE would rewrite every row's like_count).
vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    eq: vi.fn(original.eq),
    and: vi.fn(original.and),
    inArray: vi.fn(original.inArray),
    sql: original.sql,
  };
});

// Mirrors the real runBatch (server/db/index.ts): empty-array short circuit,
// otherwise delegate to the test's mocked database.batch(). likeContent and
// unlikeContent batch their like-row write with the count-repair UPDATE
// instead of awaiting them as two sequential round trips.
vi.mock("../../server/db/index", () => ({
  getDb: vi.fn(),
  runBatch: (
    database: { batch: (statements: unknown[]) => unknown },
    statements: unknown[],
  ) =>
    statements.length === 0 ? Promise.resolve([]) : database.batch(statements),
}));

import { eq } from "drizzle-orm";
import {
  ENTRY_LIKEABLE,
  GUIDE_LIKEABLE,
  hasLiked,
  likeContent,
  likedContentIds,
  loadLikeableOrThrow,
  unlikeContent,
} from "../../server/utils/like-helpers";
import {
  entries,
  entryLikes,
  guideLikes,
  guides,
} from "../../server/db/schema";
import { getDb } from "../../server/db/index";

type Db = ReturnType<typeof getDb>;

/**
 * Mocks the insert/delete/update chains the like helpers drive. `returning`
 * is what the count-repair UPDATE ... RETURNING resolves to (default: one row).
 */
function makeLikeDb(
  repairedRow: Record<string, unknown>,
  options: {
    returning?: Record<string, unknown>[];
    insertReturning?: Record<string, unknown>[];
  } = {},
) {
  const returningRows = options.returning ?? [repairedRow];
  // Rows the like insert's RETURNING resolves to: one row means a new like was
  // created; an empty array means ON CONFLICT DO NOTHING skipped the insert.
  const insertReturningRows = options.insertReturning ?? [
    { userId: "liker-2" },
  ];
  const valuesSpy = vi.fn();
  const insertReturning = vi.fn().mockResolvedValue(insertReturningRows);
  const onConflictDoNothing = vi
    .fn()
    .mockReturnValue({ returning: insertReturning });
  const insert = vi.fn().mockImplementation(() => ({
    values: (values: Record<string, unknown>) => {
      valuesSpy(values);
      return { onConflictDoNothing };
    },
  }));

  const returning = vi.fn().mockResolvedValue(returningRows);
  const updateWhere = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  // The like-row write (insert/delete) and the count-repair UPDATE now run as
  // one atomic database.batch() call (see server/utils/like-helpers.ts)
  // instead of two sequential round trips. Each statement built above is
  // already a promise (the mocked chains resolve immediately), so awaiting
  // the whole array mirrors drizzle's real "one HTTP call, every statement
  // resolves together" behaviour closely enough for these unit tests.
  const batch = vi.fn((statements: Promise<unknown>[]) =>
    Promise.all(statements),
  );

  const db = { insert, delete: deleteFn, update, batch } as unknown as Db;
  return {
    db,
    valuesSpy,
    onConflictDoNothing,
    update,
    deleteFn,
    deleteWhere,
    batch,
  };
}

/**
 * Mocks select().from().where() (awaited) and select().from().where().limit().
 */
function makeSelectDb(rows: Record<string, unknown>[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({
    where: vi.fn().mockImplementation(() => {
      const result = Promise.resolve(rows) as Promise<
        Record<string, unknown>[]
      > & { limit: typeof limit };
      result.limit = limit;
      return result;
    }),
  });
  const select = vi.fn().mockReturnValue({ from });
  const db = { select } as unknown as Db;
  return { db, select };
}

describe("likeContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a like for any user (cross-user, not scoped to the author)", async () => {
    const repaired = { id: "e-1", userId: "author-1", likeCount: 1 };
    const { db, valuesSpy } = makeLikeDb(repaired);

    const result = await likeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2");

    // The liking user (liker-2) is different from the content author
    // (author-1) and the insert is not scoped to ownership.
    expect(valuesSpy).toHaveBeenCalledWith({
      entryId: "e-1",
      userId: "liker-2",
    });
    expect(result.content).toEqual(repaired);
    expect(result.created).toBe(true);
  });

  it("reports created:false when the like already existed (ON CONFLICT skipped the insert)", async () => {
    const repaired = { id: "e-1", likeCount: 1 };
    const { db } = makeLikeDb(repaired, { insertReturning: [] });

    const result = await likeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2");

    expect(result.content).toEqual(repaired);
    expect(result.created).toBe(false);
  });

  it("is idempotent: the insert always uses ON CONFLICT DO NOTHING", async () => {
    const repaired = { id: "e-1", likeCount: 1 };
    const { db, onConflictDoNothing } = makeLikeDb(repaired);

    await likeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2");
    await likeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2");

    // A repeat like from the same user never double-inserts: idempotency is
    // delegated to the (entry_id, user_id) PK via onConflictDoNothing.
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it("repairs the count with a WHERE scoped to the one content id", async () => {
    const repaired = { id: "e-1", likeCount: 3 };
    const { db, update } = makeLikeDb(repaired);

    const result = await likeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2");

    expect(update).toHaveBeenCalledTimes(1);
    // Guard against a dropped/broad WHERE that would rewrite every entry's count.
    expect(vi.mocked(eq)).toHaveBeenCalledWith(entries.id, "e-1");
    expect(result.content).toEqual(repaired);
  });

  it("throws 404 when the row vanished before the count repair", async () => {
    const { db } = makeLikeDb({}, { returning: [] });

    await expect(
      likeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("runs the insert and the count-repair as one atomic database.batch() call", async () => {
    const repaired = { id: "e-1", likeCount: 1 };
    const { db, batch } = makeLikeDb(repaired);

    await likeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2");

    // Exactly one batch() call carrying both statements — not two sequential
    // round trips (one insert HTTP call, then a separate update HTTP call).
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
  });

  it("propagates a rejected batch without a separate, already-committed insert", async () => {
    const { db, batch } = makeLikeDb({});
    const batchError = new Error("batch failed");
    batch.mockRejectedValueOnce(batchError);

    // A failure here must surface as a single rejected batch call, not a
    // resolved insert followed by a failing count-repair call — that split
    // is exactly the committed-insert-then-stale-count gap this batching
    // closes.
    await expect(
      likeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2"),
    ).rejects.toThrow(batchError);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("inserts into the guide join table for the guide config", async () => {
    const repaired = { id: "g-1", likeCount: 1 };
    const { db, valuesSpy } = makeLikeDb(repaired);

    await likeContent(db, GUIDE_LIKEABLE, "g-1", "liker-2");

    expect(valuesSpy).toHaveBeenCalledWith({
      guideId: "g-1",
      userId: "liker-2",
    });
    expect(vi.mocked(eq)).toHaveBeenCalledWith(guides.id, "g-1");
  });
});

describe("unlikeContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the like row and returns the repaired row", async () => {
    const repaired = { id: "e-1", likeCount: 0 };
    const { db, deleteFn, deleteWhere, update } = makeLikeDb(repaired);

    const result = await unlikeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2");

    expect(deleteFn).toHaveBeenCalledWith(entryLikes);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result).toEqual(repaired);
  });

  it("throws 404 when the row vanished before the count repair", async () => {
    const { db } = makeLikeDb({}, { returning: [] });

    await expect(
      unlikeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("runs the delete and the count-repair as one atomic database.batch() call", async () => {
    const repaired = { id: "e-1", likeCount: 0 };
    const { db, batch } = makeLikeDb(repaired);

    await unlikeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2");

    // Exactly one batch() call carrying both statements — not two sequential
    // round trips (one delete HTTP call, then a separate update HTTP call).
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
  });

  it("propagates a rejected batch without a separate, already-committed delete", async () => {
    const { db, batch } = makeLikeDb({});
    const batchError = new Error("batch failed");
    batch.mockRejectedValueOnce(batchError);

    // A failure here must surface as a single rejected batch call, not a
    // resolved delete followed by a failing count-repair call — that split
    // is exactly the committed-delete-then-stale-count gap this batching
    // closes.
    await expect(
      unlikeContent(db, ENTRY_LIKEABLE, "e-1", "liker-2"),
    ).rejects.toThrow(batchError);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("targets the guide join table for the guide config", async () => {
    const repaired = { id: "g-1", likeCount: 0 };
    const { db, deleteFn } = makeLikeDb(repaired);

    await unlikeContent(db, GUIDE_LIKEABLE, "g-1", "liker-2");

    expect(deleteFn).toHaveBeenCalledWith(guideLikes);
  });
});

describe("loadLikeableOrThrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns public content to a non-owner", async () => {
    const { db } = makeSelectDb([
      { id: "e-1", visibility: "public", userId: "author-1" },
    ]);

    const row = await loadLikeableOrThrow(db, ENTRY_LIKEABLE, "e-1", "liker-2");

    expect(row).toMatchObject({ id: "e-1" });
  });

  it("returns private content to its owner", async () => {
    const { db } = makeSelectDb([
      { id: "e-1", visibility: "private", userId: "author-1" },
    ]);

    const row = await loadLikeableOrThrow(
      db,
      ENTRY_LIKEABLE,
      "e-1",
      "author-1",
    );

    expect(row).toMatchObject({ id: "e-1" });
  });

  it("throws 404 for another user's private content (no existence leak)", async () => {
    const { db } = makeSelectDb([
      { id: "e-1", visibility: "private", userId: "author-1" },
    ]);

    await expect(
      loadLikeableOrThrow(db, ENTRY_LIKEABLE, "e-1", "liker-2"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 404 when the content does not exist", async () => {
    const { db } = makeSelectDb([]);

    await expect(
      loadLikeableOrThrow(db, ENTRY_LIKEABLE, "missing", "liker-2"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("hasLiked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is true when a like row exists", async () => {
    const { db } = makeSelectDb([{ contentId: "e-1" }]);

    expect(await hasLiked(db, ENTRY_LIKEABLE, "e-1", "liker-2")).toBe(true);
  });

  it("is false when no like row exists", async () => {
    const { db } = makeSelectDb([]);

    expect(await hasLiked(db, ENTRY_LIKEABLE, "e-1", "liker-2")).toBe(false);
  });
});

describe("likedContentIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty set without querying when given no ids", async () => {
    const { db, select } = makeSelectDb([]);

    const result = await likedContentIds(db, ENTRY_LIKEABLE, [], "liker-2");

    expect(result.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it("returns the subset of ids the user liked", async () => {
    const { db } = makeSelectDb([{ contentId: "e-1" }, { contentId: "e-3" }]);

    const result = await likedContentIds(
      db,
      ENTRY_LIKEABLE,
      ["e-1", "e-2", "e-3"],
      "liker-2",
    );

    expect([...result].sort()).toEqual(["e-1", "e-3"]);
    expect(result.has("e-2")).toBe(false);
  });
});
