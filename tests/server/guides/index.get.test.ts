/**
 * Tests for GET /api/guides — list, user-scoping, and pagination.
 * Pagination mirrors GET /api/trips (server/api/trips/index.get.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockRequireUser,
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockOffset,
  mockLikesWhere,
  mockGetQuery,
  mockEq,
  mockDesc,
} = vi.hoisted(() => {
  const mockOffset = vi.fn().mockResolvedValue([]);
  const mockLimit = vi.fn(() => ({ offset: mockOffset }));
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));

  // The handler issues a second select() for likedContentIds:
  // select({ contentId }).from(guideLikes).where(...) awaited directly. That
  // chain is distinct from the guides page chain above, so the like lookup
  // resolves to its own rows rather than the paginated guides.
  const mockLikesWhere = vi.fn().mockResolvedValue([]);
  const mockLikesFrom = vi.fn(() => ({ where: mockLikesWhere }));

  const mockSelect = vi.fn(() => {
    // First select() is the guides page; any later one is the like lookup.
    if (mockSelect.mock.calls.length === 1) {
      return { from: mockFrom };
    }
    return { from: mockLikesFrom };
  });

  const mockRequireUser = vi.fn().mockReturnValue("user-1");
  const mockGetQuery = vi.fn().mockReturnValue({});
  const mockEq = vi.fn((...args: unknown[]) => ({ type: "eq", args }));
  const mockDesc = vi.fn((column: unknown) => ({ type: "desc", column }));

  return {
    mockRequireUser,
    mockSelect,
    mockFrom,
    mockWhere,
    mockOrderBy,
    mockLimit,
    mockOffset,
    mockLikesWhere,
    mockGetQuery,
    mockEq,
    mockDesc,
  };
});

vi.mock("../../../server/utils/auth", () => ({
  requireUser: mockRequireUser,
}));

vi.mock("../../../server/db/index", () => ({
  getDb: () => ({ select: mockSelect }),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: mockEq, desc: mockDesc };
});

import { guides } from "../../../server/db/schema";

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
  getQuery: mockGetQuery,
});

const { default: handler } =
  await import("../../../server/api/guides/index.get");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEvent() {
  return { context: { userId: "user-1" } };
}

function setRows(rows: unknown[]) {
  mockOffset.mockResolvedValue(rows);
}

// The rows likedContentIds resolves to — each `{ contentId }` marks that
// content as liked by the current user for the like-state assertions.
function setLikedIds(likeRows: { contentId: string }[]) {
  mockLikesWhere.mockResolvedValue(likeRows);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/guides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({});
    mockOffset.mockResolvedValue([]);
    mockLikesWhere.mockResolvedValue([]);
  });

  it("returns guides scoped to the authenticated user, flagged by like state", async () => {
    const storedGuides = [
      { id: "g-1", userId: "user-1", title: "Tokyo on foot" },
      { id: "g-2", userId: "user-1", title: "Slow coastlines" },
    ];
    setRows(storedGuides);
    // The user has liked g-1 but not g-2.
    setLikedIds([{ contentId: "g-1" }]);

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { guides: unknown[]; page: number; hasMore: boolean };

    expect(result).toEqual({
      guides: [
        { ...storedGuides[0], likedByCurrentUser: true },
        { ...storedGuides[1], likedByCurrentUser: false },
      ],
      page: 1,
      hasMore: false,
    });
    // The list must be scoped to the authenticated user, not every guide —
    // assert the exact column/value so a filter dropped or moved to another
    // column (a cross-tenant leak) fails this test.
    expect(mockEq).toHaveBeenCalledWith(guides.userId, "user-1");
  });

  it("scopes the query to the authenticated user's id", async () => {
    mockRequireUser.mockReturnValue("user-42");

    await (handler as (event: object) => unknown)({
      context: { userId: "user-42" },
    });

    expect(mockEq).toHaveBeenCalledWith(guides.userId, "user-42");
  });

  it("returns an empty guides array when the user has no guides", async () => {
    setRows([]);

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { guides: unknown[] };

    expect(result.guides).toEqual([]);
  });

  it("orders by createdAt desc with id as the secondary tie-break", async () => {
    await (handler as (event: object) => unknown)(buildEvent());

    // Assert argument order, not just presence: a swap to (id, createdAt)
    // reorders the whole list and breaks pagination, so it must fail here.
    expect(mockOrderBy).toHaveBeenCalledWith(
      { type: "desc", column: guides.createdAt },
      { type: "desc", column: guides.id },
    );
  });

  it("throws 401 when not authenticated", async () => {
    mockRequireUser.mockImplementation(() => {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    });

    await expect(
      (handler as (event: object) => unknown)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  // -------------------------------------------------------------------------
  // Pagination — these fail against the pre-fix unbounded query.
  // -------------------------------------------------------------------------

  it("defaults to page 1 and offset 0 with a bounded limit when no page specified", async () => {
    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockLimit).toHaveBeenCalledWith(20);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it("returns at most PAGE_SIZE guides with correct metadata on the first page", async () => {
    const fullPage = Array.from({ length: 20 }, (_, index) => ({
      id: `g-${index}`,
      userId: "user-1",
      title: `Guide ${index}`,
    }));
    setRows(fullPage);

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { guides: unknown[]; page: number; hasMore: boolean };

    expect(result.guides).toHaveLength(20);
    expect(result.page).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(mockLimit).toHaveBeenCalledWith(20);
  });

  it("returns the correct slice on a later page", async () => {
    mockGetQuery.mockReturnValue({ page: "2" });
    const secondPageRows = [
      { id: "g-20", userId: "user-1", title: "Guide 20" },
    ];
    setRows(secondPageRows);

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { guides: unknown[]; page: number; hasMore: boolean };

    expect(result.guides).toEqual([
      { ...secondPageRows[0], likedByCurrentUser: false },
    ]);
    expect(result.page).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(mockOffset).toHaveBeenCalledWith(20);
    expect(mockLimit).toHaveBeenCalledWith(20);
  });

  it("returns an empty list rather than erroring for an out-of-range page", async () => {
    mockGetQuery.mockReturnValue({ page: "999" });
    setRows([]);

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { guides: unknown[]; page: number; hasMore: boolean };

    expect(result.guides).toEqual([]);
    expect(result.page).toBe(999);
    expect(result.hasMore).toBe(false);
    expect(mockOffset).toHaveBeenCalledWith((999 - 1) * 20);
  });

  it("falls back to page 1 for a page beyond the MAX_PAGE bound", async () => {
    mockGetQuery.mockReturnValue({ page: "1001" });

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it("honors the page exactly at the MAX_PAGE bound", async () => {
    mockGetQuery.mockReturnValue({ page: "1000" });

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { page: number };

    expect(result.page).toBe(1000);
    expect(mockOffset).toHaveBeenCalledWith((1000 - 1) * 20);
  });

  it("reports hasMore: false at MAX_PAGE even with a full page, since there is no page 1001 to serve", async () => {
    mockGetQuery.mockReturnValue({ page: "1000" });
    const fullPage = Array.from({ length: 20 }, (_, index) => ({
      id: `g-${index}`,
      userId: "user-1",
      title: `Guide ${index}`,
    }));
    setRows(fullPage);

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { hasMore: boolean };

    expect(result.hasMore).toBe(false);
  });

  it("falls back to page 1 when the page param arrives as an array (repeated query key)", async () => {
    mockGetQuery.mockReturnValue({ page: ["1", "2"] });

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it("falls back to page 1 for a non-safe-integer page param (e.g. 1e300)", async () => {
    mockGetQuery.mockReturnValue({ page: "1e300" });

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it("falls back to page 1 for a non-numeric page param", async () => {
    mockGetQuery.mockReturnValue({ page: "not-a-number" });

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it("falls back to page 1 for a negative page param", async () => {
    mockGetQuery.mockReturnValue({ page: "-3" });

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it("falls back to page 1 for a zero page param", async () => {
    mockGetQuery.mockReturnValue({ page: "0" });

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(),
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });
});
