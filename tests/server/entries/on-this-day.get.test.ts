import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("../../../server/utils/on-this-day-helpers", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../../server/utils/on-this-day-helpers")
    >();
  return {
    ...original,
    fetchOnThisDayEntries: vi.fn(),
  };
});

import { requireUser } from "../../../server/utils/auth";
import { fetchOnThisDayEntries } from "../../../server/utils/on-this-day-helpers";

const mockRequireUser = vi.mocked(requireUser);
const mockFetchOnThisDayEntries = vi.mocked(fetchOnThisDayEntries);

const handler = await import("../../../server/api/entries/on-this-day.get");

describe("GET /api/entries/on-this-day", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns entries scoped to the authenticated user", async () => {
    const sampleEntries = [
      { id: "e-1", userId: "user-1", title: "Old entry", photos: [], tags: [] },
    ];
    mockRequireUser.mockReturnValue("user-1");
    mockFetchOnThisDayEntries.mockResolvedValue(
      sampleEntries as unknown as Awaited<
        ReturnType<typeof fetchOnThisDayEntries>
      >,
    );

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(result).toEqual({ entries: sampleEntries });
    expect(mockFetchOnThisDayEntries).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        month: expect.any(Number),
        day: expect.any(Number),
        year: expect.any(Number),
      }),
    );
  });

  it("keys off the viewer's local date from the query param", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockFetchOnThisDayEntries.mockResolvedValue([]);

    const defaultHandler = "default" in handler ? handler.default : handler;
    await (defaultHandler as (event: unknown) => unknown)({
      query: { date: "2020-03-15" },
    });

    expect(mockFetchOnThisDayEntries).toHaveBeenCalledWith("user-1", {
      month: 3,
      day: 15,
      year: 2020,
    });
  });

  it("falls back to the server clock's UTC date when no query param is given", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockFetchOnThisDayEntries.mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));

    try {
      const defaultHandler = "default" in handler ? handler.default : handler;
      await (defaultHandler as (event: unknown) => unknown)({});

      expect(mockFetchOnThisDayEntries).toHaveBeenCalledWith("user-1", {
        month: 6,
        day: 28,
        year: 2026,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns an empty entries array when there are no matches", async () => {
    mockRequireUser.mockReturnValue("user-1");
    mockFetchOnThisDayEntries.mockResolvedValue([]);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(result).toEqual({ entries: [] });
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
});
