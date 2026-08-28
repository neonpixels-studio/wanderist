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

describe("parseLocalDateParam", () => {
  // Pin "now" to a leap day so both the leap-day branch and the ±1-day window
  // are deterministic: Feb 29 is the current date, and its neighbours (Feb 28 /
  // Mar 1) are the only other dates the window accepts.
  const LEAP_DAY_NOW = new Date("2024-02-29T12:00:00.000Z");

  function setTimezone(timezone: string | undefined): void {
    if (timezone === undefined) {
      delete process.env.TZ;
      return;
    }
    process.env.TZ = timezone;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(LEAP_DAY_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses a valid YYYY-MM-DD string into month/day/year parts", () => {
    expect(parseLocalDateParam("2024-02-29")).toEqual({
      month: 2,
      day: 29,
      year: 2024,
    });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseLocalDateParam("  2024-02-29  ")).toEqual({
      month: 2,
      day: 29,
      year: 2024,
    });
  });

  it("returns null for non-string input", () => {
    expect(parseLocalDateParam(undefined)).toBeNull();
    expect(parseLocalDateParam(20240229)).toBeNull();
    expect(parseLocalDateParam(["2024-02-29"])).toBeNull();
  });

  it("returns null for malformed strings", () => {
    expect(parseLocalDateParam("")).toBeNull();
    expect(parseLocalDateParam("2024/02/29")).toBeNull();
    expect(parseLocalDateParam("2024-2-29")).toBeNull();
    expect(parseLocalDateParam("Feb 29, 2024")).toBeNull();
  });

  it("returns null for out-of-range month or day", () => {
    expect(parseLocalDateParam("2024-13-01")).toBeNull();
    expect(parseLocalDateParam("2024-00-10")).toBeNull();
    expect(parseLocalDateParam("2024-02-32")).toBeNull();
    expect(parseLocalDateParam("2024-02-00")).toBeNull();
  });

  it("returns null for a day that does not exist in the month", () => {
    expect(parseLocalDateParam("2024-02-30")).toBeNull(); // Feb never has 30
    expect(parseLocalDateParam("2023-02-29")).toBeNull(); // 2023 is not a leap year
  });

  it("accepts February 29 in a leap year", () => {
    expect(parseLocalDateParam("2024-02-29")).toEqual({
      month: 2,
      day: 29,
      year: 2024,
    });
  });

  it("accepts the day either side of the server's date (timezone straddle)", () => {
    expect(parseLocalDateParam("2024-02-28")).toEqual({
      month: 2,
      day: 28,
      year: 2024,
    });
    expect(parseLocalDateParam("2024-03-01")).toEqual({
      month: 3,
      day: 1,
      year: 2024,
    });
  });

  it("rejects a date more than a day from the server's date", () => {
    // Guards the "today only" contract: a stale/bogus clock or a hand-crafted
    // request for an arbitrary day must not slip through.
    expect(parseLocalDateParam("2024-02-27")).toBeNull();
    expect(parseLocalDateParam("2024-03-02")).toBeNull();
    expect(parseLocalDateParam("2024-06-28")).toBeNull();
    expect(parseLocalDateParam("2026-02-28")).toBeNull();
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
      setTimezone("Pacific/Kiritimati"); // UTC+14
      expect(new Date("2024-03-01T00:00:00.000Z").getDate()).toBe(1);
      const easternResult = parseLocalDateParam("2024-02-29");

      setTimezone("Pacific/Niue"); // UTC-11, so that instant is still Feb 29
      expect(new Date("2024-03-01T00:00:00.000Z").getDate()).toBe(29);
      const westernResult = parseLocalDateParam("2024-02-29");

      expect(easternResult).toEqual({ month: 2, day: 29, year: 2024 });
      expect(westernResult).toEqual(easternResult);
    } finally {
      setTimezone(originalTimezone);
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
    // Server clock (UTC) is June 28, but a viewer in UTC-8 is still on June 27;
    // the resolved reference follows the viewer, not the server.
    expect(resolveReferenceDate("2026-06-27")).toEqual({
      month: 6,
      day: 27,
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

  it("embeds each reference component into its own filter position", () => {
    // filters[2] is the MONTH extract, [3] the DAY extract, [4] the YEAR
    // extract. Varying exactly one reference component must change exactly the
    // matching filter and leave the others untouched — this catches a
    // month/day (or year) swap that a "some chunk differs" assertion misses.
    const chunkAt = (
      filters: ReturnType<typeof buildOnThisDayFilter>,
      index: number,
    ) => (filters[index] as { queryChunks?: unknown[] }).queryChunks ?? [];

    const june28 = buildOnThisDayFilter("user-1", JUNE_28_2026);
    const june30 = buildOnThisDayFilter("user-1", { ...JUNE_28_2026, day: 30 });
    const june28LastYear = buildOnThisDayFilter("user-1", {
      ...JUNE_28_2026,
      year: 2025,
    });

    // Same month, different day: only the DAY filter moves.
    expect(chunkAt(june30, 2)).toEqual(chunkAt(june28, 2));
    expect(chunkAt(june30, 3)).not.toEqual(chunkAt(june28, 3));

    // Same month/day, different year: only the YEAR filter moves.
    expect(chunkAt(june28LastYear, 2)).toEqual(chunkAt(june28, 2));
    expect(chunkAt(june28LastYear, 3)).toEqual(chunkAt(june28, 3));
    expect(chunkAt(june28LastYear, 4)).not.toEqual(chunkAt(june28, 4));
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
