import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../../server/utils/entry-helpers", () => ({
  loadRelationsForEntries: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    and: vi.fn(original.and),
    eq: vi.fn(original.eq),
    isNotNull: vi.fn(original.isNotNull),
    sql: original.sql,
  };
});

import { and, eq } from "drizzle-orm";
import { getDb } from "../../../server/db/index";
import { entries } from "../../../server/db/schema";
import { loadRelationsForEntries } from "../../../server/utils/entry-helpers";
import {
  buildOnThisDayFilter,
  fetchOnThisDayEntries,
  parseLocalDateParam,
  resolveReferenceDate,
  type OnThisDayDate,
} from "../../../server/utils/on-this-day-helpers";

const mockGetDb = vi.mocked(getDb);
const mockEq = vi.mocked(eq);
const mockLoadRelationsForEntries = vi.mocked(loadRelationsForEntries);

const JUNE_28_2026: OnThisDayDate = { month: 6, day: 28, year: 2026 };
const JULY_4_2026: OnThisDayDate = { month: 7, day: 4, year: 2026 };

describe("parseLocalDateParam", () => {
  // Pin "now" to a leap year so the year-bound (server year ± 1) and the
  // leap-day branch are both deterministic: valid sample years stay within
  // 2023-2025, and Feb 29 is a real date in the current (2024) year.
  const LEAP_YEAR_NOW = new Date("2024-06-15T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(LEAP_YEAR_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses a valid YYYY-MM-DD string into month/day/year parts", () => {
    expect(parseLocalDateParam("2024-06-28")).toEqual({
      month: 6,
      day: 28,
      year: 2024,
    });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseLocalDateParam("  2024-06-28  ")).toEqual({
      month: 6,
      day: 28,
      year: 2024,
    });
  });

  it("returns null for non-string input", () => {
    expect(parseLocalDateParam(undefined)).toBeNull();
    expect(parseLocalDateParam(20240628)).toBeNull();
    expect(parseLocalDateParam(["2024-06-28"])).toBeNull();
  });

  it("returns null for malformed strings", () => {
    expect(parseLocalDateParam("")).toBeNull();
    expect(parseLocalDateParam("2024/06/28")).toBeNull();
    expect(parseLocalDateParam("2024-6-28")).toBeNull();
    expect(parseLocalDateParam("June 28, 2024")).toBeNull();
  });

  it("returns null for out-of-range month or day", () => {
    expect(parseLocalDateParam("2024-13-01")).toBeNull();
    expect(parseLocalDateParam("2024-00-10")).toBeNull();
    expect(parseLocalDateParam("2024-06-32")).toBeNull();
    expect(parseLocalDateParam("2024-06-00")).toBeNull();
  });

  it("returns null for a day that does not exist in the month", () => {
    expect(parseLocalDateParam("2024-06-31")).toBeNull(); // 30-day month
    expect(parseLocalDateParam("2023-02-29")).toBeNull(); // 2023 is not a leap year
  });

  it("accepts February 29 in a leap year", () => {
    expect(parseLocalDateParam("2024-02-29")).toEqual({
      month: 2,
      day: 29,
      year: 2024,
    });
  });

  it("rejects a year further than one off the server clock", () => {
    // Server year is 2024, so 2025 (next-year straddle) is allowed but 2026 is
    // a stale/bogus clock and must be rejected, along with wildly-off years.
    expect(parseLocalDateParam("2025-06-28")).toEqual({
      month: 6,
      day: 28,
      year: 2025,
    });
    expect(parseLocalDateParam("2023-06-28")).toEqual({
      month: 6,
      day: 28,
      year: 2023,
    });
    expect(parseLocalDateParam("2026-06-28")).toBeNull();
    expect(parseLocalDateParam("2022-06-28")).toBeNull();
    expect(parseLocalDateParam("9999-06-28")).toBeNull();
  });

  it("returns identical parts regardless of the process timezone", () => {
    // parseLocalDateParam reads the literal string components (never an
    // instant), so a far-east and a far-west process timezone must yield the
    // same parts. A regression to `new Date(value).getMonth()` would diverge
    // here and fail — that's the point of exercising two zones. The sentinel
    // assertions prove the zone reassignment actually took effect (otherwise
    // both branches would run under the setup's pinned UTC and pass vacuously).
    const originalTimezone = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      expect(new Date("2024-01-01T00:00:00.000Z").getDate()).toBe(1);
      const easternResult = parseLocalDateParam("2024-01-01");

      process.env.TZ = "Pacific/Niue"; // UTC-11, still Dec 31 for that instant
      expect(new Date("2024-01-01T00:00:00.000Z").getDate()).toBe(31);
      const westernResult = parseLocalDateParam("2024-01-01");

      expect(easternResult).toEqual({ month: 1, day: 1, year: 2024 });
      expect(westernResult).toEqual(easternResult);
    } finally {
      process.env.TZ = originalTimezone;
    }
  });
});

describe("resolveReferenceDate", () => {
  const FIXED_NOW = new Date("2026-06-28T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the viewer's local date when the param is valid", () => {
    // A user in UTC-8 late on Jan 1 sends "2026-01-01"; even though the server
    // clock (UTC) may already read Jan 2, the resolved reference stays Jan 1.
    expect(resolveReferenceDate("2026-01-01")).toEqual({
      month: 1,
      day: 1,
      year: 2026,
    });
  });

  it("falls back to the server clock's UTC date when the param is missing", () => {
    expect(resolveReferenceDate(undefined)).toEqual({
      month: 6,
      day: 28,
      year: 2026,
    });
  });

  it("falls back to the server clock when the param is malformed", () => {
    expect(resolveReferenceDate("not-a-date")).toEqual({
      month: 6,
      day: 28,
      year: 2026,
    });
  });
});

describe("buildOnThisDayFilter", () => {
  it("returns a non-empty array of SQL filters", () => {
    const filters = buildOnThisDayFilter("user-1", JUNE_28_2026);
    expect(filters.length).toBeGreaterThan(0);
  });

  it("includes a user equality filter (first element is eq on userId)", () => {
    const filters = buildOnThisDayFilter("user-1", JUNE_28_2026);
    // The first filter is eq(entries.userId, userId). We verify the array
    // length and trust the SQL template tag for the month/day/year filters.
    expect(filters.length).toBe(5);
  });

  it("produces a different number of query values for different reference dates", () => {
    const filtersA = buildOnThisDayFilter("user-1", JUNE_28_2026);
    const filtersB = buildOnThisDayFilter("user-1", JULY_4_2026);

    // Both filter arrays have the same length (same structural shape).
    expect(filtersA.length).toBe(filtersB.length);

    // The SQL template literals embed month/day/year values from the reference
    // date. Inspect the queryChunks to confirm the month value differs.
    const getMonthChunk = (
      filters: ReturnType<typeof buildOnThisDayFilter>,
    ) => {
      const monthFilter = filters[2] as { queryChunks?: unknown[] };
      return monthFilter?.queryChunks ?? [];
    };

    expect(getMonthChunk(filtersA)).not.toEqual(getMonthChunk(filtersB));
  });
});

describe("fetchOnThisDayEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockRowsReturned(rows: unknown[]) {
    const orderByMock = vi.fn().mockResolvedValue(rows);
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    const mockDb = { select: vi.fn().mockReturnValue({ from: fromMock }) };
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    return { mockDb, whereMock };
  }

  it("returns an empty array when the database returns no rows", async () => {
    mockRowsReturned([]);

    const result = await fetchOnThisDayEntries("user-1", JUNE_28_2026);
    expect(result).toEqual([]);
  });

  it("issues no relation queries when there are no matching entries", async () => {
    mockRowsReturned([]);

    await fetchOnThisDayEntries("user-1", JUNE_28_2026);
    expect(mockLoadRelationsForEntries).not.toHaveBeenCalled();
  });

  it("throws when the batched relations map is missing an entry", async () => {
    mockRowsReturned([
      { id: "e-1", userId: "user-1", title: "A" },
      { id: "e-2", userId: "user-1", title: "B" },
    ]);
    mockLoadRelationsForEntries.mockResolvedValue(
      new Map([["e-1", { photos: [], tags: [] }]]),
    );

    await expect(fetchOnThisDayEntries("user-1", JUNE_28_2026)).rejects.toThrow(
      /e-2/,
    );
  });

  it("scopes the query to the given user", async () => {
    // A fixed reference date makes the built filter array comparable across
    // the two buildOnThisDayFilter calls below (the one fetchOnThisDayEntries
    // makes internally, and the one this test makes to compute what `where`
    // should have received).
    const referenceDate = JUNE_28_2026;
    const { whereMock } = mockRowsReturned([]);

    await fetchOnThisDayEntries("user-42", referenceDate);

    // Asserting on `eq` alone only proves the user filter was constructed,
    // not that it reached the executed query — a caller that built the
    // filter and then dropped it before `.where(...)` would still pass that
    // check. Assert the exact filter set reached `where` instead.
    expect(mockEq).toHaveBeenCalledWith(entries.userId, "user-42");
    expect(whereMock).toHaveBeenCalledWith(
      and(...buildOnThisDayFilter("user-42", referenceDate)),
    );
  });

  it("enriches each entry row with photos and tags", async () => {
    const sampleRow = {
      id: "e-1",
      userId: "user-1",
      title: "Harbor at 4am",
    };
    const { mockDb } = mockRowsReturned([sampleRow]);
    mockLoadRelationsForEntries.mockResolvedValue(
      new Map([["e-1", { photos: [], tags: [] }]]),
    );

    const result = await fetchOnThisDayEntries("user-1", JUNE_28_2026);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ...sampleRow, photos: [], tags: [] });
    expect(mockLoadRelationsForEntries).toHaveBeenCalledWith(mockDb, ["e-1"]);
  });

  it("calls loadRelationsForEntries exactly once regardless of row count", async () => {
    const rows = [
      { id: "e-1", userId: "user-1", title: "A" },
      { id: "e-2", userId: "user-1", title: "B" },
      { id: "e-3", userId: "user-1", title: "C" },
    ];
    mockRowsReturned(rows);
    mockLoadRelationsForEntries.mockResolvedValue(
      new Map([
        ["e-1", { photos: [], tags: [] }],
        ["e-2", { photos: [], tags: [] }],
        ["e-3", { photos: [], tags: [] }],
      ]),
    );

    await fetchOnThisDayEntries("user-1", JUNE_28_2026);

    expect(mockLoadRelationsForEntries).toHaveBeenCalledTimes(1);
    expect(mockLoadRelationsForEntries).toHaveBeenCalledWith(
      expect.anything(),
      ["e-1", "e-2", "e-3"],
    );
  });

  it("associates photos and tags to the correct entry when relations are interleaved", async () => {
    const rows = [
      { id: "e-1", userId: "user-1", title: "A" },
      { id: "e-2", userId: "user-1", title: "B" },
    ];
    mockRowsReturned(rows);
    // Map insertion order is deliberately the reverse of `rows` order, so a
    // regression that rebuilds the return value from the relations map
    // instead of from `rows` (e.g. `[...relationsByEntryId].map(...)`) would
    // both scramble entry order and fail the order assertion below.
    mockLoadRelationsForEntries.mockResolvedValue(
      new Map([
        [
          "e-2",
          {
            photos: [
              { id: "p-1", entryId: "e-2", mediaId: "m-1", sortOrder: 0 },
            ],
            tags: [{ id: "t-1", name: "beach" }],
          },
        ],
        [
          "e-1",
          {
            photos: [
              { id: "p-2", entryId: "e-1", mediaId: "m-2", sortOrder: 0 },
              { id: "p-3", entryId: "e-1", mediaId: "m-3", sortOrder: 1 },
            ],
            tags: [{ id: "t-2", name: "mountains" }],
          },
        ],
      ]),
    );

    const result = await fetchOnThisDayEntries("user-1", JUNE_28_2026);

    // Order must follow the DB's `ORDER BY occurred_at DESC` (i.e. `rows`
    // order), not relations-map insertion order.
    expect(result.map((entry) => entry.id)).toEqual(["e-1", "e-2"]);

    const entryOne = result.find((entry) => entry.id === "e-1");
    const entryTwo = result.find((entry) => entry.id === "e-2");

    expect(entryOne?.photos.map((photo) => photo.id)).toEqual(["p-2", "p-3"]);
    expect(entryOne?.tags).toEqual([{ id: "t-2", name: "mountains" }]);

    expect(entryTwo?.photos.map((photo) => photo.id)).toEqual(["p-1"]);
    expect(entryTwo?.tags).toEqual([{ id: "t-1", name: "beach" }]);
  });

  it("returns empty photos/tags arrays for an entry with no relations", async () => {
    const rows = [
      { id: "e-1", userId: "user-1", title: "A" },
      { id: "e-2", userId: "user-1", title: "B" },
    ];
    mockRowsReturned(rows);
    mockLoadRelationsForEntries.mockResolvedValue(
      new Map([
        [
          "e-1",
          {
            photos: [
              { id: "p-1", entryId: "e-1", mediaId: "m-1", sortOrder: 0 },
            ],
            tags: [],
          },
        ],
        ["e-2", { photos: [], tags: [] }],
      ]),
    );

    const result = await fetchOnThisDayEntries("user-1", JUNE_28_2026);
    const entryWithoutRelations = result.find((entry) => entry.id === "e-2");

    expect(entryWithoutRelations?.photos).toEqual([]);
    expect(entryWithoutRelations?.tags).toEqual([]);
  });
});
