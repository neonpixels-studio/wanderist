/**
 * Tests for deleteMediaIfUnreferenced (cover image cleanup).
 *
 * The Netlify Blobs interaction is mocked at the mediaStore seam so no network
 * or real store is touched. The drizzle query builder is stubbed with a small
 * chainable fake; the conditional-delete predicate is compiled with PgDialect
 * to prove the reference guard lives inside the single DELETE statement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockRemoveMediaBlob, mockToThumbnailKey } = vi.hoisted(() => ({
  mockRemoveMediaBlob: vi.fn().mockResolvedValue(undefined),
  mockToThumbnailKey: vi.fn((key: string) => `${key}-thumb`),
}));

vi.mock("../../../server/utils/mediaStore", () => ({
  removeMediaBlob: mockRemoveMediaBlob,
  toThumbnailKey: mockToThumbnailKey,
}));

Object.assign(globalThis, {
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
});

const { deleteMediaIfUnreferenced, assertCoverImageOwned } =
  await import("../../../server/utils/coverImageCleanup");
const { media } = await import("../../../server/db/schema");

const OWNER_ID = "user-1";
const MEDIA_ID = "media-1";
const MEDIA_URL = "user-1/media-1";

// ---------------------------------------------------------------------------
// Chainable drizzle fake
// ---------------------------------------------------------------------------

type SelectRows = Record<string, unknown>[];

// Stubs the two builders the cleanup uses:
//   - delete(media).where(cond).returning() — the atomic conditional delete,
//     resolving to `deletedRows` (the rows the DELETE ... RETURNING removed).
//   - select().from().where().limit() — the ownership lookup in
//     assertCoverImageOwned, resolving to `mediaRows`.
// `deleteWhere` is exposed so a test can inspect the predicate the DELETE ran
// with and prove the reference guard is inside that single statement.
function makeDb(options: { deletedRows?: SelectRows; mediaRows?: SelectRows }) {
  const deleteReturning = vi.fn().mockResolvedValue(options.deletedRows ?? []);
  // Declares the predicate parameter so the atomicity test can read
  // deleteWhere.mock.calls[0][0] without a tuple-index type error under tsc.
  const deleteWhere = vi.fn((_condition: unknown) => ({
    returning: deleteReturning,
  }));
  const deleteFrom = vi.fn(() => ({ where: deleteWhere }));

  const select = vi.fn(() => {
    const limit = vi.fn().mockResolvedValue(options.mediaRows ?? []);
    return {
      from: () => ({ where: vi.fn(() => ({ limit })) }),
    };
  });

  const database = { select, delete: deleteFrom };
  return { database, deleteFrom, deleteWhere, deleteReturning };
}

describe("deleteMediaIfUnreferenced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history only, not implementations, so re-set
    // both mediaStore mocks here — otherwise the blob-failure test's rejection
    // would leak into any test added below it.
    mockToThumbnailKey.mockImplementation((key: string) => `${key}-thumb`);
    mockRemoveMediaBlob.mockResolvedValue(undefined);
  });

  it("deletes both blobs and reports success when the conditional delete removes a row", async () => {
    const { database, deleteFrom } = makeDb({
      deletedRows: [{ url: MEDIA_URL }],
    });

    const deleted = await deleteMediaIfUnreferenced(
      database as never,
      OWNER_ID,
      MEDIA_ID,
    );

    expect(deleted).toBe(true);
    expect(deleteFrom).toHaveBeenCalledWith(media);
    expect(mockRemoveMediaBlob).toHaveBeenCalledWith(MEDIA_URL);
    expect(mockRemoveMediaBlob).toHaveBeenCalledWith(`${MEDIA_URL}-thumb`);
  });

  it("reports failure and touches no blobs when the conditional delete removes nothing", async () => {
    // An empty RETURNING is how the single statement signals "left in place":
    // the row was still referenced (or already gone), so the WHERE matched
    // nothing. The delete still runs — it just deletes zero rows.
    const { database } = makeDb({ deletedRows: [] });

    const deleted = await deleteMediaIfUnreferenced(
      database as never,
      OWNER_ID,
      MEDIA_ID,
    );

    expect(deleted).toBe(false);
    expect(mockRemoveMediaBlob).not.toHaveBeenCalled();
  });

  // Regression guard for the TOCTOU fix (#166): the reference check must live
  // inside the DELETE's WHERE, not in a separate query. If it doesn't, a
  // concurrent insert referencing the media between a standalone check and the
  // delete can be cascaded away. Compiling the predicate the delete ran with
  // proves both referencing tables are guarded in the one statement.
  it("guards the delete with NOT EXISTS against every referencing table in a single statement", async () => {
    const { database, deleteWhere } = makeDb({
      deletedRows: [{ url: MEDIA_URL }],
    });

    await deleteMediaIfUnreferenced(database as never, OWNER_ID, MEDIA_ID);

    expect(deleteWhere).toHaveBeenCalledTimes(1);
    const deletePredicate = deleteWhere.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(
      deletePredicate as never,
    );

    // Pin the whole compiled predicate, not fragments: substring checks would
    // survive an `and`→`or`, a `not exists`→`exists`, or a wrong-column binding.
    expect(sql).toBe(
      '("media"."id" = $1 and "media"."user_id" = $2 ' +
        'and not exists (select 1 from "trips" where "trips"."cover_image_id" = $3) ' +
        'and not exists (select 1 from "entry_photos" where "entry_photos"."media_id" = $4))',
    );
    expect(params).toEqual([MEDIA_ID, OWNER_ID, MEDIA_ID, MEDIA_ID]);
  });

  it("still reports success when blob removal fails", async () => {
    const { database, deleteFrom } = makeDb({
      deletedRows: [{ url: MEDIA_URL }],
    });
    mockRemoveMediaBlob.mockRejectedValue(new Error("store unavailable"));

    const deleted = await deleteMediaIfUnreferenced(
      database as never,
      OWNER_ID,
      MEDIA_ID,
    );

    expect(deleted).toBe(true);
    expect(deleteFrom).toHaveBeenCalledWith(media);
  });
});

describe("assertCoverImageOwned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves when the media row is owned by the user", async () => {
    const { database } = makeDb({ mediaRows: [{ id: MEDIA_ID }] });

    await expect(
      assertCoverImageOwned(database as never, OWNER_ID, MEDIA_ID),
    ).resolves.toBeUndefined();
  });

  it("throws 404 when the media row is missing or owned by another user", async () => {
    const { database } = makeDb({ mediaRows: [] });

    await expect(
      assertCoverImageOwned(database as never, OWNER_ID, MEDIA_ID),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
