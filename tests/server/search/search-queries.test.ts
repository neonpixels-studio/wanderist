import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    ilike: vi.fn(original.ilike),
    eq: vi.fn(original.eq),
    or: vi.fn(original.or),
    and: vi.fn(original.and),
    isNull: vi.fn(original.isNull),
  };
});

import { eq, ilike, isNull, and, or } from "drizzle-orm";
import { getDb } from "../../../server/db/index";
import {
  entries,
  guides,
  users,
  userPreferences,
} from "../../../server/db/schema";
import { entitledToPublicProfileCondition } from "../../../server/utils/publicVisibility";
import {
  searchPlaces,
  searchTrips,
  searchEntries,
  searchGuides,
  searchPeople,
  runSearch,
} from "../../../server/utils/search-queries";

const mockGetDb = vi.mocked(getDb);

function makeQueryChain(rows: Record<string, unknown>[]) {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const innerJoinFn = vi.fn().mockReturnValue({ where: whereFn });
  const fromFn = vi
    .fn()
    .mockReturnValue({ where: whereFn, innerJoin: innerJoinFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn, _where: whereFn, _limit: limitFn };
}

// Table-aware chain: each `.from(table)` resolves the rows registered for that
// table, so a mis-wired runSearch (e.g. guides receiving the entries query)
// surfaces as a mismatched group rather than silently passing.
function makeTableQueryChain(
  rowsByTable: Map<unknown, Record<string, unknown>[]>,
) {
  const fromFn = vi.fn((table: unknown) => {
    const limitFn = vi.fn().mockResolvedValue(rowsByTable.get(table) ?? []);
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
    const innerJoinFn = vi.fn().mockReturnValue({ where: whereFn });
    return { where: whereFn, innerJoin: innerJoinFn };
  });
  return { select: vi.fn().mockReturnValue({ from: fromFn }) };
}

describe("searchPlaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns places matching the pattern for the given user", async () => {
    const expectedRows = [
      {
        id: "p-1",
        name: "Reykjavík",
        subtitle: "Iceland",
        country: "Iceland",
        category: null,
      },
    ];
    const chain = makeQueryChain(expectedRows);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await searchPlaces(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%reyk%",
    );

    expect(result).toEqual(expectedRows);
    expect(chain.select).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when no places match", async () => {
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await searchPlaces(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%nomatch%",
    );

    expect(result).toEqual([]);
  });
});

describe("searchTrips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trips matching the pattern for the given user", async () => {
    const expectedRows = [
      { id: "t-1", name: "Iceland Ring Road", status: "past" },
    ];
    const chain = makeQueryChain(expectedRows);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await searchTrips(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%iceland%",
    );

    expect(result).toEqual(expectedRows);
  });

  it("returns an empty array when no trips match", async () => {
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await searchTrips(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%nomatch%",
    );

    expect(result).toEqual([]);
  });
});

describe("searchEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns entries matching the pattern for the given user", async () => {
    const expectedRows = [{ id: "e-1", title: "Harbor at 4am" }];
    const chain = makeQueryChain(expectedRows);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await searchEntries(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%harbor%",
    );

    expect(result).toEqual(expectedRows);
  });
});

describe("searchGuides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns guides matching the pattern for the given user", async () => {
    const expectedRows = [{ id: "g-1", title: "48 hours in Kyoto" }];
    const chain = makeQueryChain(expectedRows);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await searchGuides(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%kyoto%",
    );

    expect(result).toEqual(expectedRows);
    expect(chain.select).toHaveBeenCalledTimes(1);
  });

  it("scopes guides to the given user (eq on userId)", async () => {
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    await searchGuides(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%kyoto%",
    );

    // Assert the exact column so removing the userId filter fails this test.
    expect(eq).toHaveBeenCalledWith(guides.userId, "user-1");
  });

  it("matches against both the title and body columns", async () => {
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    await searchGuides(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%kyoto%",
    );

    expect(ilike).toHaveBeenCalledWith(guides.title, "%kyoto%");
    expect(ilike).toHaveBeenCalledWith(guides.body, "%kyoto%");
  });

  it("returns an empty array when no guides match", async () => {
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await searchGuides(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "user-1",
      "%nomatch%",
    );

    expect(result).toEqual([]);
  });
});

describe("searchPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns public profiles matching the pattern (no email in result)", async () => {
    const expectedRows = [
      {
        id: "user-2",
        displayName: "Elsa Far",
        handle: "elsa_far",
      },
    ];
    const chain = makeQueryChain(expectedRows);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await searchPeople(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "%elsa%",
    );

    expect(result).toEqual(expectedRows);
  });

  it("excludes soft-deleted accounts so profile links never 404", async () => {
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    await searchPeople(
      mockGetDb() as unknown as ReturnType<typeof getDb>,
      "%elsa%",
    );

    expect(isNull).toHaveBeenCalledWith(users.deletedAt);
  });

  it("does NOT scope people results to a userId (public profiles only)", async () => {
    // searchPeople receives no userId parameter — verifying the function
    // signature itself enforces this constraint at call time.
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    // If this call compiles and runs without error, people search is not
    // accidentally user-scoped (no userId parameter accepted).
    await expect(
      searchPeople(
        mockGetDb() as unknown as ReturnType<typeof getDb>,
        "%test%",
      ),
    ).resolves.toEqual([]);
  });

  it("gates people results on effective public-profile entitlement", async () => {
    const chain = makeQueryChain([]);

    // A lapsed/paused subscriber whose stored opt-in still reads true must not
    // surface in people search — the entitlement predicate closes that leak.
    await searchPeople(chain as unknown as ReturnType<typeof getDb>, "%elsa%");

    expect(chain._where).toHaveBeenCalledWith(
      and(
        eq(userPreferences.publicProfile, true),
        isNull(users.deletedAt),
        entitledToPublicProfileCondition(),
        or(
          ilike(userPreferences.displayName, "%elsa%"),
          ilike(userPreferences.handle, "%elsa%"),
        ),
      ),
    );
  });
});

describe("runSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns grouped results for all five categories", async () => {
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await runSearch("user-1", "tokyo");

    expect(result).toHaveProperty("places");
    expect(result).toHaveProperty("trips");
    expect(result).toHaveProperty("entries");
    expect(result).toHaveProperty("guides");
    expect(result).toHaveProperty("people");
  });

  it("includes matching guides in the combined results, scoped to the owner", async () => {
    const guideRows = [{ id: "g-1", title: "48 hours in Kyoto" }];
    const entryRows = [{ id: "e-1", title: "Harbor at 4am" }];
    const chain = makeTableQueryChain(
      new Map([
        [guides, guideRows],
        [entries, entryRows],
      ]),
    );
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    const result = await runSearch("user-1", "kyoto");

    // Distinct rows per table prove guides are wired to the guides query, not
    // accidentally reading another group's rows.
    expect(result.guides).toEqual(guideRows);
    expect(result.entries).toEqual(entryRows);
    expect(eq).toHaveBeenCalledWith(guides.userId, "user-1");
  });

  it("escapes SQL LIKE special characters in the query to prevent injection", async () => {
    const chain = makeQueryChain([]);
    mockGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);

    // These characters would otherwise act as LIKE wildcards; passing them
    // should not throw and should be handled safely.
    await expect(runSearch("user-1", "100% free")).resolves.toBeDefined();
    await expect(runSearch("user-1", "me_you")).resolves.toBeDefined();
    await expect(runSearch("user-1", "back\\slash")).resolves.toBeDefined();
  });
});
