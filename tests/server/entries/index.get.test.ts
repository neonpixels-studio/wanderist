import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

vi.stubGlobal("getQuery", vi.fn().mockReturnValue({}));

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    asc: vi.fn(original.asc),
    eq: vi.fn(original.eq),
    and: vi.fn(original.and),
    desc: vi.fn(original.desc),
    inArray: vi.fn(original.inArray),
  };
});

import { requireUser } from "../../../server/utils/auth";
import { getDb } from "../../../server/db/index";

const mockRequireUser = vi.mocked(requireUser);
const mockGetDb = vi.mocked(getDb);
const mockGetQuery = vi.mocked(
  globalThis.getQuery as (event: unknown) => Record<string, unknown>,
);

function makeDbForListing(
  rows: Record<string, unknown>[],
  likeRows: { contentId: string }[] = [],
) {
  const offsetMock = vi.fn().mockResolvedValue(rows);
  const limitMock = vi.fn().mockReturnValue({ offset: offsetMock });
  const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
  const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });

  const photosOrderByMock = vi.fn().mockResolvedValue([]);
  const photosWhereMock = vi
    .fn()
    .mockReturnValue({ orderBy: photosOrderByMock });
  const photosFromMock = vi.fn().mockReturnValue({ where: photosWhereMock });

  const tagsWhereMock = vi.fn().mockResolvedValue([]);
  const tagsInnerJoinMock = vi.fn().mockReturnValue({ where: tagsWhereMock });
  const tagsFromMock = vi
    .fn()
    .mockReturnValue({ innerJoin: tagsInnerJoinMock });

  // likedContentIds: select({ contentId }).from(entryLikes).where(...) awaited.
  const likesWhereMock = vi.fn().mockResolvedValue(likeRows);
  const likesFromMock = vi.fn().mockReturnValue({ where: likesWhereMock });

  const selectDistinctWhereMock = vi.fn().mockResolvedValue([]);
  const selectDistinctInnerJoinMock = vi
    .fn()
    .mockReturnValue({ where: selectDistinctWhereMock });
  const selectDistinctFromMock = vi
    .fn()
    .mockReturnValue({ innerJoin: selectDistinctInnerJoinMock });
  const selectDistinctMock = vi
    .fn()
    .mockReturnValue({ from: selectDistinctFromMock });

  let callCount = 0;

  return {
    select: vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: fromMock };
      }
      if (callCount === 2) {
        return { from: photosFromMock };
      }
      if (callCount === 3) {
        return { from: tagsFromMock };
      }
      return { from: likesFromMock };
    }),
    selectDistinct: selectDistinctMock,
    _whereMock: whereMock,
  };
}

const handler = await import("../../../server/api/entries/index.get");

describe("GET /api/entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockReturnValue({});
  });

  it("returns entries scoped to the user, each flagged by like state", async () => {
    const storedEntries = [
      { id: "e-1", userId: "user-1", title: "First Entry" },
      { id: "e-2", userId: "user-1", title: "Second Entry" },
    ];
    mockRequireUser.mockReturnValue("user-1");
    // The user has liked e-1 but not e-2.
    const mockDb = makeDbForListing(storedEntries, [{ contentId: "e-1" }]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { entries: { id: string; likedByCurrentUser: boolean }[] };

    expect(result.entries).toEqual([
      { ...storedEntries[0], photos: [], tags: [], likedByCurrentUser: true },
      { ...storedEntries[1], photos: [], tags: [], likedByCurrentUser: false },
    ]);
  });

  it("throws 401 when not authenticated", async () => {
    const unauthorizedError = createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
    mockRequireUser.mockImplementation(() => {
      throw unauthorizedError;
    });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it.each([
    ["no tab specified", {}, "timeline"],
    ["tab=timeline", { tab: "timeline" }, "timeline"],
    ["invalid tab", { tab: "unknown" }, "timeline"],
  ])("returns tab=timeline when %s", async (_label, query, expectedTab) => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue(query);
    const mockDb = makeDbForListing([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { tab: string };

    expect(result.tab).toBe(expectedTab);
  });

  it("defaults to page 1 when no page specified", async () => {
    mockRequireUser.mockReturnValue("user-1");
    const mockDb = makeDbForListing([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as {
      page: number;
    };

    expect(result.page).toBe(1);
  });

  it("reports hasMore: true when a full page of entries is returned", async () => {
    const fullPage = Array.from({ length: 20 }, (_, index) => ({
      id: `e-${index}`,
      userId: "user-1",
      title: `Entry ${index}`,
    }));
    mockRequireUser.mockReturnValue("user-1");
    const mockDb = makeDbForListing(fullPage);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { entries: unknown[]; hasMore: boolean };

    expect(result.entries).toHaveLength(20);
    expect(result.hasMore).toBe(true);
  });

  it("reports hasMore: false when the page is short", async () => {
    const shortPage = [{ id: "e-1", userId: "user-1", title: "Only Entry" }];
    mockRequireUser.mockReturnValue("user-1");
    const mockDb = makeDbForListing(shortPage);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { hasMore: boolean };

    expect(result.hasMore).toBe(false);
  });

  it("reports hasMore: false for photos tab when no entries have photos", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ tab: "photos" });

    const selectDistinctWhereMock = vi.fn().mockResolvedValue([]);
    const selectDistinctInnerJoinMock = vi
      .fn()
      .mockReturnValue({ where: selectDistinctWhereMock });
    const selectDistinctFromMock = vi
      .fn()
      .mockReturnValue({ innerJoin: selectDistinctInnerJoinMock });
    const mockDb = {
      select: vi.fn().mockReturnValue({ from: vi.fn() }),
      selectDistinct: vi.fn().mockReturnValue({ from: selectDistinctFromMock }),
    };
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { hasMore: boolean };

    expect(result.hasMore).toBe(false);
  });

  it("returns empty entries for photos tab when no entries have photos", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ tab: "photos" });

    const selectDistinctWhereMock = vi.fn().mockResolvedValue([]);
    const selectDistinctInnerJoinMock = vi
      .fn()
      .mockReturnValue({ where: selectDistinctWhereMock });
    const selectDistinctFromMock = vi
      .fn()
      .mockReturnValue({ innerJoin: selectDistinctInnerJoinMock });
    const mockDb = {
      select: vi.fn().mockReturnValue({ from: vi.fn() }),
      selectDistinct: vi.fn().mockReturnValue({ from: selectDistinctFromMock }),
    };
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as {
      entries: unknown[];
      tab: string;
    };

    expect(result.entries).toEqual([]);
    expect(result.tab).toBe("photos");
  });
});
