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
    eq: vi.fn(original.eq),
    and: vi.fn(original.and),
    desc: vi.fn(original.desc),
  };
});

import { requireUser } from "../../../server/utils/auth";
import { getDb } from "../../../server/db/index";

const mockRequireUser = vi.mocked(requireUser);
const mockGetDb = vi.mocked(getDb);
const mockGetQuery = vi.mocked(
  globalThis.getQuery as (event: unknown) => Record<string, unknown>,
);

function makeDbWithRows(rows: Record<string, unknown>[]) {
  const offsetMock = vi.fn().mockResolvedValue(rows);
  const limitMock = vi.fn().mockReturnValue({ offset: offsetMock });
  const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
  const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const selectMock = vi.fn().mockReturnValue({ from: fromMock });
  return {
    select: selectMock,
    _where: whereMock,
    _limit: limitMock,
    _offset: offsetMock,
  };
}

const handler = await import("../../../server/api/places/index.get");

describe("GET /api/places", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockReturnValue({});
  });

  it("returns places scoped to the authenticated user", async () => {
    const expectedPlaces = [
      { id: "p-1", userId: "user-1", name: "Tokyo" },
      { id: "p-2", userId: "user-1", name: "London" },
    ];
    mockRequireUser.mockReturnValue("user-1");
    const mockDb = makeDbWithRows(expectedPlaces);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(result).toEqual({
      places: expectedPlaces,
      page: 1,
      hasMore: false,
    });
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

  it("passes category filter as a query param when provided", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ category: "museum" });
    const mockDb = makeDbWithRows([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    await (defaultHandler as (event: unknown) => unknown)({});

    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty category filter", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ category: "  " });
    const mockDb = makeDbWithRows([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    await (defaultHandler as (event: unknown) => unknown)({});

    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("defaults to page 1 and offset 0 when no page specified", async () => {
    mockRequireUser.mockReturnValue("user-1");
    const mockDb = makeDbWithRows([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockDb._offset).toHaveBeenCalledWith(0);
    expect(mockDb._limit).toHaveBeenCalledWith(20);
  });

  it("returns PAGE_SIZE rows with correct metadata on the first page", async () => {
    const fullPage = Array.from({ length: 20 }, (_, index) => ({
      id: `p-${index}`,
      userId: "user-1",
      name: `Place ${index}`,
    }));
    mockRequireUser.mockReturnValue("user-1");
    const mockDb = makeDbWithRows(fullPage);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { places: unknown[]; page: number; hasMore: boolean };

    expect(result.places).toHaveLength(20);
    expect(result.page).toBe(1);
    expect(result.hasMore).toBe(true);
  });

  it("reports hasMore: false when the page is short", async () => {
    const shortPage = [{ id: "p-1", userId: "user-1", name: "Tokyo" }];
    mockRequireUser.mockReturnValue("user-1");
    const mockDb = makeDbWithRows(shortPage);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { hasMore: boolean };

    expect(result.hasMore).toBe(false);
  });

  it("applies the correct offset for page 2", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ page: "2" });
    const mockDb = makeDbWithRows([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { page: number };

    expect(result.page).toBe(2);
    expect(mockDb._offset).toHaveBeenCalledWith(20);
    expect(mockDb._limit).toHaveBeenCalledWith(20);
  });

  it("falls back to page 1 for an invalid page param", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ page: "not-a-number" });
    const mockDb = makeDbWithRows([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockDb._offset).toHaveBeenCalledWith(0);
  });

  it("falls back to page 1 for a non-safe-integer page param (e.g. 1e300)", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ page: "1e300" });
    const mockDb = makeDbWithRows([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockDb._offset).toHaveBeenCalledWith(0);
  });

  it("falls back to page 1 for a page beyond the MAX_PAGE bound", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ page: "1001" });
    const mockDb = makeDbWithRows([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { page: number };

    expect(result.page).toBe(1);
    expect(mockDb._offset).toHaveBeenCalledWith(0);
  });

  it("honors the page exactly at the MAX_PAGE bound", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ page: "1000" });
    const mockDb = makeDbWithRows([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { page: number };

    expect(result.page).toBe(1000);
    expect(mockDb._offset).toHaveBeenCalledWith((1000 - 1) * 20);
  });

  it("reports hasMore: false at MAX_PAGE even with a full page", async () => {
    const fullPage = Array.from({ length: 20 }, (_, index) => ({
      id: `p-${index}`,
      userId: "user-1",
      name: `Place ${index}`,
    }));
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ page: "1000" });
    const mockDb = makeDbWithRows(fullPage);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = (await (defaultHandler as (event: unknown) => unknown)(
      {},
    )) as { hasMore: boolean };

    expect(result.hasMore).toBe(false);
  });
});
