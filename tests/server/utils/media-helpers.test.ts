/**
 * Tests for assertPhotoMediaOwned.
 *
 * The drizzle query builder is stubbed with a small chainable fake: select ->
 * from -> where resolves to whatever owned rows the test supplies, so the helper
 * can be exercised without a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { media } from "../../../server/db/schema";

Object.assign(globalThis, {
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
});

const { assertPhotoMediaOwned } =
  await import("../../../server/utils/media-helpers");

const OWNER_ID = "user-1";

// select().from().where() resolves directly to the supplied owned rows; the
// where spy is returned so a test can assert the query was issued (or not).
function makeDb(ownedRows: { id: string }[]) {
  const where = vi.fn().mockResolvedValue(ownedRows);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { database: { select }, select, where };
}

describe("assertPhotoMediaOwned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not query the database for an empty list", async () => {
    const { database, select } = makeDb([]);

    await expect(
      assertPhotoMediaOwned(database as never, OWNER_ID, []),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("resolves and scopes the query to the owner when every id belongs to them", async () => {
    const { database, where } = makeDb([{ id: "media-1" }, { id: "media-2" }]);

    await expect(
      assertPhotoMediaOwned(database as never, OWNER_ID, [
        "media-1",
        "media-2",
      ]),
    ).resolves.toBeUndefined();
    // Assert the owner predicate is part of the query: dropping the
    // eq(media.userId, ...) scope would reintroduce the cross-user leak this
    // helper closes, and this expectation fails if it is removed.
    expect(where).toHaveBeenCalledWith(
      and(
        inArray(media.id, ["media-1", "media-2"]),
        eq(media.userId, OWNER_ID),
      ),
    );
  });

  it("de-duplicates ids before querying and comparing against the owned count", async () => {
    // One owned row satisfies a list with a duplicate id.
    const { database, where } = makeDb([{ id: "media-1" }]);

    await expect(
      assertPhotoMediaOwned(database as never, OWNER_ID, [
        "media-1",
        "media-1",
      ]),
    ).resolves.toBeUndefined();
    expect(where).toHaveBeenCalledWith(
      and(inArray(media.id, ["media-1"]), eq(media.userId, OWNER_ID)),
    );
  });

  it("throws 404 when a foreign id is present (fewer owned rows than ids)", async () => {
    // Only media-1 is owned; media-foreign belongs to someone else, so the
    // owned query returns a single row for a two-id request.
    const { database } = makeDb([{ id: "media-1" }]);

    await expect(
      assertPhotoMediaOwned(database as never, OWNER_ID, [
        "media-1",
        "media-foreign",
      ]),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 404 when the id does not exist at all", async () => {
    const { database } = makeDb([]);

    await expect(
      assertPhotoMediaOwned(database as never, OWNER_ID, ["missing-media"]),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
