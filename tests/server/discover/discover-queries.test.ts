/**
 * Unit tests for discover-queries.ts
 *
 * All DB interactions are mocked so tests run without a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq, notInArray } from "drizzle-orm";
import {
  fetchFeaturedTrips,
  fetchTrendingPlaces,
  fetchGuides,
  fetchSuggestedPeople,
  discoverableAuthorCondition,
} from "../../../server/utils/discover-queries";
import type { Database } from "../../../server/utils/discover-queries";
import { publiclyVisibleAuthorCondition } from "../../../server/utils/publicVisibility";
import {
  trips,
  users,
  userPreferences,
  guides,
  VISIBILITY,
} from "../../../server/db/schema";

// ---------------------------------------------------------------------------
// Helpers to build mock DB query chains
// ---------------------------------------------------------------------------

function buildSelectChain(rows: unknown[]) {
  const result = vi.fn().mockResolvedValue(rows);
  const orderBy = vi
    .fn()
    .mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) });
  const groupBy = vi.fn().mockReturnValue({ orderBy });
  const where = vi.fn().mockReturnValue({
    groupBy,
    orderBy,
    limit: vi.fn().mockResolvedValue(rows),
  });
  const innerJoin = vi
    .fn()
    .mockReturnValue({ where, innerJoin: vi.fn().mockReturnValue({ where }) });
  const from = vi.fn().mockReturnValue({ innerJoin, where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, result, where };
}

// ---------------------------------------------------------------------------
// fetchFeaturedTrips
// ---------------------------------------------------------------------------

describe("fetchFeaturedTrips", () => {
  it("returns mapped trip rows from the database", async () => {
    const rawRows = [
      {
        id: "trip-1",
        name: "Iceland Ring Road",
        status: "past",
        ownerHandle: "elsa_far",
        ownerDisplayName: "Elsa",
        stopCount: "7",
      },
    ];

    const chain = buildSelectChain(rawRows);
    const database = chain as unknown as Database;

    const result = await fetchFeaturedTrips(database);

    expect(result).toEqual([
      {
        id: "trip-1",
        name: "Iceland Ring Road",
        status: "past",
        ownerHandle: "elsa_far",
        ownerDisplayName: "Elsa",
        stopCount: 7,
      },
    ]);
  });

  it("returns an empty array when no public trips exist", async () => {
    const chain = buildSelectChain([]);
    const database = chain as unknown as Database;

    const result = await fetchFeaturedTrips(database);

    expect(result).toEqual([]);
  });

  it("coerces string stopCount to a number", async () => {
    const rawRows = [
      {
        id: "trip-2",
        name: "Portugal Coast",
        status: "upcoming",
        ownerHandle: null,
        ownerDisplayName: "Marco",
        stopCount: "3",
      },
    ];

    const chain = buildSelectChain(rawRows);
    const database = chain as unknown as Database;

    const result = await fetchFeaturedTrips(database);

    expect(result[0]?.stopCount).toBe(3);
    expect(typeof result[0]?.stopCount).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// fetchTrendingPlaces
// ---------------------------------------------------------------------------

describe("fetchTrendingPlaces", () => {
  it("returns mapped trending place rows", async () => {
    const rawRows = [
      {
        name: "Reynisfjara",
        country: "Iceland",
        category: "nature",
        saveCount: "42",
        recentSaveCount: "18",
      },
    ];

    const chain = buildSelectChain(rawRows);
    const database = chain as unknown as Database;

    const result = await fetchTrendingPlaces(database, null);

    expect(result).toEqual([
      {
        name: "Reynisfjara",
        country: "Iceland",
        category: "nature",
        saveCount: 42,
        recentSaveCount: 18,
      },
    ]);
  });

  it("returns an empty array when no places are trending", async () => {
    const chain = buildSelectChain([]);
    const database = chain as unknown as Database;

    const result = await fetchTrendingPlaces(database, null);

    expect(result).toEqual([]);
  });

  it("coerces string save counts to numbers", async () => {
    const rawRows = [
      {
        name: "Alfama",
        country: "Portugal",
        category: "city",
        saveCount: "100",
        recentSaveCount: "24",
      },
    ];

    const chain = buildSelectChain(rawRows);
    const database = chain as unknown as Database;

    const result = await fetchTrendingPlaces(database, "city");

    expect(typeof result[0]?.saveCount).toBe("number");
    expect(typeof result[0]?.recentSaveCount).toBe("number");
    expect(result[0]?.saveCount).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// fetchGuides
// ---------------------------------------------------------------------------

describe("fetchGuides", () => {
  it("returns mapped guide rows", async () => {
    const rawRows = [
      {
        id: "guide-1",
        title: "Cold-water swimming in Iceland",
        readTimeMinutes: 8,
        likeCount: 412,
        ownerHandle: "elsa_far",
        ownerDisplayName: "Elsa",
      },
    ];

    const chain = buildSelectChain(rawRows);
    const database = chain as unknown as Database;

    const result = await fetchGuides(database);

    expect(result).toEqual(rawRows);
  });

  it("returns an empty array when no public guides exist", async () => {
    const chain = buildSelectChain([]);
    const database = chain as unknown as Database;

    const result = await fetchGuides(database);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchSuggestedPeople
// ---------------------------------------------------------------------------

describe("fetchSuggestedPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns suggested people excluding the current user", async () => {
    const followsRows = [{ followeeId: "user-2" }];
    const peopleRows = [
      {
        userId: "user-3",
        displayName: "Marco",
        handle: "marco.travels",
        homeBase: "Lisbon",
        placeCount: "84",
      },
    ];

    let callCount = 0;
    const limit = vi.fn().mockResolvedValue(peopleRows);
    const whereForPeople = vi
      .fn()
      .mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit }) });
    const whereForFollows = vi.fn().mockResolvedValue(followsRows);

    const from = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return { where: whereForFollows };
      }
      return { innerJoin: vi.fn().mockReturnValue({ where: whereForPeople }) };
    });

    const select = vi.fn().mockReturnValue({ from });
    const database = { select } as unknown as Database;

    const result = await fetchSuggestedPeople(database, "user-1");

    expect(result).toEqual([
      {
        userId: "user-3",
        displayName: "Marco",
        handle: "marco.travels",
        homeBase: "Lisbon",
        placeCount: 84,
      },
    ]);
  });

  it("returns an empty array when no suitable people exist", async () => {
    let callCount = 0;
    const limit = vi.fn().mockResolvedValue([]);
    const where2 = vi
      .fn()
      .mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit }) });

    const from = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return { where: vi.fn().mockResolvedValue([]) };
      }
      return { innerJoin: vi.fn().mockReturnValue({ where: where2 }) };
    });

    const select = vi.fn().mockReturnValue({ from });
    const database = { select } as unknown as Database;

    const result = await fetchSuggestedPeople(database, "user-1");

    expect(result).toEqual([]);
  });

  it("coerces string placeCount to a number", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        userId: "user-4",
        displayName: "Yuki",
        handle: "yuki",
        homeBase: "Tokyo",
        placeCount: "510",
      },
    ]);
    const where2 = vi
      .fn()
      .mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit }) });

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return { where: vi.fn().mockResolvedValue([]) };
      }
      return { innerJoin: vi.fn().mockReturnValue({ where: where2 }) };
    });

    const select = vi.fn().mockReturnValue({ from });
    const database = { select } as unknown as Database;

    const result = await fetchSuggestedPeople(database, "user-1");

    expect(result[0]?.placeCount).toBe(510);
    expect(typeof result[0]?.placeCount).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Effective public-profile gating
//
// Every explore surface must gate on effective entitlement, not just the stored
// publicProfile opt-in — otherwise a lapsed/paused Nomad whose opt-in still
// reads true stays surfaced. These assert the entitlement predicate is present
// in each query's WHERE; dropping it would silently reopen the leak.
// ---------------------------------------------------------------------------

describe("effective public-profile gating", () => {
  it("discoverableAuthorCondition layers showOnExplore on the shared visibility gate", () => {
    expect(discoverableAuthorCondition()).toEqual(
      and(
        publiclyVisibleAuthorCondition(),
        eq(userPreferences.showOnExplore, true),
      ),
    );
  });

  it("fetchFeaturedTrips gates on effective entitlement", async () => {
    const chain = buildSelectChain([]);

    await fetchFeaturedTrips(chain as unknown as Database);

    expect(chain.where).toHaveBeenCalledWith(
      and(
        eq(trips.visibility, VISIBILITY.PUBLIC),
        discoverableAuthorCondition(),
      ),
    );
  });

  it("fetchTrendingPlaces gates on effective entitlement", async () => {
    const chain = buildSelectChain([]);

    await fetchTrendingPlaces(chain as unknown as Database, null);

    expect(chain.where).toHaveBeenCalledWith(discoverableAuthorCondition());
  });

  it("fetchGuides gates on effective entitlement", async () => {
    const chain = buildSelectChain([]);

    await fetchGuides(chain as unknown as Database);

    expect(chain.where).toHaveBeenCalledWith(
      and(
        eq(guides.visibility, VISIBILITY.PUBLIC),
        discoverableAuthorCondition(),
      ),
    );
  });

  it("fetchSuggestedPeople gates on effective entitlement", async () => {
    const capturedWhere = vi.fn().mockReturnValue({
      orderBy: vi
        .fn()
        .mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
    });
    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return { where: vi.fn().mockResolvedValue([{ followeeId: "user-2" }]) };
      }
      return { innerJoin: vi.fn().mockReturnValue({ where: capturedWhere }) };
    });
    const database = {
      select: vi.fn().mockReturnValue({ from }),
    } as unknown as Database;

    await fetchSuggestedPeople(database, "user-1");

    expect(capturedWhere).toHaveBeenCalledWith(
      and(
        discoverableAuthorCondition(),
        notInArray(users.id, ["user-2", "user-1"]),
      ),
    );
  });
});
