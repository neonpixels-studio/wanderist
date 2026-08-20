/**
 * Tests for assertPlaceOwnedIfPresent.
 *
 * The drizzle query builder is stubbed with a small chainable fake: select ->
 * from -> where -> limit resolves to whatever owned rows the test supplies, so
 * the helper can be exercised without a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { places } from "../../../server/db/schema";

Object.assign(globalThis, {
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
});

const { assertPlaceOwnedIfPresent } =
  await import("../../../server/utils/place-helpers");

const OWNER_ID = "user-1";

// select().from().where().limit() resolves to the supplied owned rows; the
// where spy is returned so a test can assert the query was issued (or not).
function makeDb(ownedRows: { id: string }[]) {
  const limit = vi.fn().mockResolvedValue(ownedRows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { database: { select }, select, where };
}

describe("assertPlaceOwnedIfPresent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not query the database when placeId is undefined", async () => {
    const { database, select } = makeDb([]);

    await expect(
      assertPlaceOwnedIfPresent(database as never, OWNER_ID, undefined),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("does not query the database when placeId is null", async () => {
    const { database, select } = makeDb([]);

    await expect(
      assertPlaceOwnedIfPresent(database as never, OWNER_ID, null),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("resolves and scopes the query to the owner when the place belongs to them", async () => {
    const { database, where } = makeDb([{ id: "place-1" }]);

    await expect(
      assertPlaceOwnedIfPresent(database as never, OWNER_ID, "place-1"),
    ).resolves.toBeUndefined();
    // Assert the owner predicate is part of the query: dropping the
    // eq(places.userId, ...) scope would reintroduce the cross-user reference
    // this helper closes, and this expectation fails if it is removed.
    expect(where).toHaveBeenCalledWith(
      and(eq(places.id, "place-1"), eq(places.userId, OWNER_ID)),
    );
  });

  it("throws 404 when the place belongs to another user", async () => {
    // The owner-scoped query returns no rows for a place owned by someone else.
    const { database } = makeDb([]);

    await expect(
      assertPlaceOwnedIfPresent(database as never, OWNER_ID, "place-foreign"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 404 when the place does not exist at all", async () => {
    const { database } = makeDb([]);

    await expect(
      assertPlaceOwnedIfPresent(database as never, OWNER_ID, "missing-place"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("looks up an empty-string id rather than short-circuiting it", async () => {
    // Only undefined/null are no-ops; "" is a real (invalid) id, so it is
    // queried and rejected rather than silently passing the check.
    const { database, select } = makeDb([]);

    await expect(
      assertPlaceOwnedIfPresent(database as never, OWNER_ID, ""),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(select).toHaveBeenCalled();
  });
});
