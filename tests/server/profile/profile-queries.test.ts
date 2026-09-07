/**
 * Unit tests for profile-queries.ts
 *
 * DB interactions are mocked. Because the mock chain resolves the same rows
 * regardless of the predicates, the privacy-critical filters are asserted
 * explicitly against the arguments passed to `.where()` — otherwise removing
 * `publicProfile`/`deletedAt` would silently pass while leaking private data.
 *
 * Some privacy filters do not live in `.where()`: `fetchProfileRow` defaults a
 * prefs-less account to private via `coalesce(publicProfile, false)` and drops
 * soft-deleted counterparties from the count subqueries via `deleted_at IS NULL`
 * — all inside `.select()`. The mock never runs SQL, so those would flip
 * silently. To give them teeth, the captured `.select()` fragments are rendered
 * to real SQL text with Drizzle's PgDialect and asserted directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, desc, eq, isNull, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { stubNitroGlobals } from "../test-utils";

// requireViewableProfileTarget's own dependencies (requireUser, getDb) are
// mocked here so its wiring can be tested without a real auth context or
// database connection; requireViewableProfile itself runs for real (it lives
// in the same module, so it can't be mocked independently) against a fake
// query chain, exactly like the `requireViewableProfile` suite below.
vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
}));
vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

import {
  fetchProfileRow,
  fetchProfileVisibility,
  fetchFollowers,
  fetchPublicTrips,
  fetchPublicGuides,
  requireViewableProfile,
  requireViewableProfileTarget,
  FOLLOWERS_PAGE_SIZE,
  PROFILE_TRIPS_PAGE_SIZE,
  PROFILE_GUIDES_PAGE_SIZE,
} from "../../../server/utils/profile-queries";
import type { Database } from "../../../server/utils/profile-queries";
import { requireUser } from "../../../server/utils/auth";
import { getDb } from "../../../server/db/index";
import {
  follows,
  guides,
  trips,
  users,
  userPreferences,
  subscriptions,
  PLAN,
  SUBSCRIPTION_STATUS,
  VISIBILITY,
} from "../../../server/db/schema";
import { publiclyVisibleAuthorCondition } from "../../../server/utils/publicVisibility";
import { discoverableAuthorCondition } from "../../../server/utils/discover-queries";

// requireViewableProfile throws via createError; stub the Nitro globals so it
// resolves outside the Nuxt runtime.
stubNitroGlobals();

// Builds a mock query chain where every builder method returns the same object
// and the terminal `limit`/`orderBy` resolve to the supplied rows. This covers
// select → from → (inner/left)Join* → where → (orderBy) → limit.
function buildSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const innerJoin = vi.fn();
  const leftJoin = vi.fn();
  innerJoin.mockReturnValue({ innerJoin, leftJoin, where });
  leftJoin.mockReturnValue({ innerJoin, leftJoin, where });
  const from = vi.fn().mockReturnValue({ innerJoin, leftJoin, where });
  const select = vi.fn().mockReturnValue({ from });
  return {
    chain: { select },
    select,
    from,
    innerJoin,
    leftJoin,
    where,
    orderBy,
    limit,
  };
}

const pgDialect = new PgDialect();

// Renders one field from a captured `.select({...})` object to real SQL text so
// filters embedded in the count subqueries (and the coalesce default) become
// assertable — the mock resolves rows without ever running this SQL. Guards the
// field so a rename surfaces the missing key instead of a cryptic Drizzle throw.
function renderSelectField(
  selection: Record<string, unknown>,
  field: string,
): string {
  const fragment = selection[field];
  if (!(fragment instanceof SQL)) {
    throw new Error(`select() field "${field}" is not an SQL fragment`);
  }
  return pgDialect.sqlToQuery(fragment).sql.toLowerCase();
}

// Runs fetchProfileRow against an empty result set and returns the object it
// passed to `.select()`, so the privacy filters built into those fields can be
// rendered and asserted.
async function captureProfileSelection(): Promise<Record<string, unknown>> {
  const built = buildSelectChain([]);
  await fetchProfileRow(built.chain as unknown as Database, "user-1");
  return built.select.mock.calls[0][0] as Record<string, unknown>;
}

describe("fetchProfileRow", () => {
  it("maps the row and coerces subquery counts to numbers", async () => {
    const rawRow = {
      userId: "user-1",
      displayName: "Elsa",
      handle: "elsa_far",
      homeBase: "Reykjavik",
      bio: "Cold-water swimmer",
      publicProfile: true,
      subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
      subscriptionPlan: PLAN.NOMAD,
      followerCount: "12",
      followingCount: "4",
      placeCount: "37",
    };
    const built = buildSelectChain([rawRow]);

    const result = await fetchProfileRow(
      built.chain as unknown as Database,
      "user-1",
    );

    // The raw subscription fields are consumed to derive effectivelyPublic and
    // never leaked back to the caller (a viewer must not learn another user's
    // billing status).
    expect(result).toEqual({
      userId: "user-1",
      displayName: "Elsa",
      handle: "elsa_far",
      homeBase: "Reykjavik",
      bio: "Cold-water swimmer",
      publicProfile: true,
      effectivelyPublic: true,
      followerCount: 12,
      followingCount: 4,
      placeCount: 37,
    });
  });

  it("derives effectivelyPublic false when the opt-in is true but the subscription lapsed", async () => {
    const rawRow = {
      userId: "user-1",
      displayName: "Elsa",
      handle: "elsa_far",
      homeBase: "Reykjavik",
      bio: null,
      publicProfile: true,
      subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
      subscriptionPlan: PLAN.NOMAD,
      followerCount: "0",
      followingCount: "0",
      placeCount: "0",
    };
    const built = buildSelectChain([rawRow]);

    const result = await fetchProfileRow(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result).toMatchObject({
      publicProfile: true,
      effectivelyPublic: false,
    });
  });

  it("scopes the query to the user id and excludes soft-deleted users", async () => {
    const built = buildSelectChain([]);

    await fetchProfileRow(built.chain as unknown as Database, "user-1");

    expect(built.where).toHaveBeenCalledWith(
      and(eq(users.id, "user-1"), isNull(users.deletedAt)),
    );
  });

  it("left-joins preferences and subscriptions so a user without either row still resolves", async () => {
    const built = buildSelectChain([]);

    await fetchProfileRow(built.chain as unknown as Database, "user-1");

    // Inner joins here would 404 a brand-new user on their own profile, or a
    // free user with no subscriptions row.
    expect(built.leftJoin).toHaveBeenCalledTimes(2);
    expect(built.innerJoin).not.toHaveBeenCalled();
  });

  it("returns null when no matching user row exists", async () => {
    const built = buildSelectChain([]);

    const result = await fetchProfileRow(
      built.chain as unknown as Database,
      "missing",
    );

    expect(result).toBeNull();
  });

  it("defaults a prefs-less profile to private (coalesce publicProfile to false)", async () => {
    // A user who never opened settings has no preferences row, so publicProfile
    // is NULL. The coalesce default is the only thing keeping them private:
    // flipping it to true would make every prefs-less account world-readable.
    // Anchored to public_profile so substituting a different flag also fails.
    const publicProfileSql = renderSelectField(
      await captureProfileSelection(),
      "publicProfile",
    );
    expect(publicProfileSql).toMatch(
      /coalesce\("?user_preferences"?\."?public_profile"?,\s*false\)/,
    );
  });

  // Assert the whole subquery clause as one anchored shape, not loose tokens, so
  // structural weakenings are caught: an inner JOIN (not LEFT JOIN, which would
  // make deleted_at IS NULL true for unmatched rows), the counterparty joined on
  // the correct follow column (not re-aliased onto the profile's own row), a
  // correlation anchored to users.id (not the left-joined prefs row, which zeroes
  // the count), and the soft-delete filter AND-ed on (not OR-ed, which counts
  // every follow row). `\s+` spans the newlines in the rendered SQL.
  it.each([
    [
      "followerCount",
      /from follows\s+join users as follower_users on follower_users\.id\s*=\s*follows\.follower_id\s+where\s+follows\.followee_id\s*=\s*"users"\."id"\s+and\s+follower_users\.deleted_at\s+is\s+null/,
    ],
    [
      "followingCount",
      /from follows\s+join users as followee_users on followee_users\.id\s*=\s*follows\.followee_id\s+where\s+follows\.follower_id\s*=\s*"users"\."id"\s+and\s+followee_users\.deleted_at\s+is\s+null/,
    ],
  ] as const)(
    "counts only non-deleted, correctly-correlated %s rows",
    async (field, subqueryPredicate) => {
      const countSql = renderSelectField(
        await captureProfileSelection(),
        field,
      );
      expect(countSql).toMatch(subqueryPredicate);
    },
  );

  it("scopes the place count to the profile owner", async () => {
    // places has no soft-delete or visibility column, so the only thing that
    // can silently break here is the correlation column — swapping it would
    // return a different user's place count on this profile.
    const placeCountSql = renderSelectField(
      await captureProfileSelection(),
      "placeCount",
    );
    expect(placeCountSql).toMatch(/places\.user_id\s*=\s*"users"\."id"/);
  });
});

describe("fetchProfileVisibility", () => {
  it("derives effectivelyPublic true for an opted-in, entitled user", async () => {
    const built = buildSelectChain([
      {
        userId: "user-1",
        publicProfile: true,
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        subscriptionPlan: PLAN.NOMAD,
      },
    ]);

    const result = await fetchProfileVisibility(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result).toEqual({ userId: "user-1", effectivelyPublic: true });
  });

  it("derives effectivelyPublic false when opted in but the subscription lapsed", async () => {
    const built = buildSelectChain([
      {
        userId: "user-1",
        publicProfile: true,
        subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
        subscriptionPlan: PLAN.NOMAD,
      },
    ]);

    const result = await fetchProfileVisibility(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result).toEqual({ userId: "user-1", effectivelyPublic: false });
  });

  it("returns null when no matching user row exists", async () => {
    const built = buildSelectChain([]);

    const result = await fetchProfileVisibility(
      built.chain as unknown as Database,
      "missing",
    );

    expect(result).toBeNull();
  });

  it("scopes the query to the user id and excludes soft-deleted users", async () => {
    const built = buildSelectChain([]);

    await fetchProfileVisibility(built.chain as unknown as Database, "user-1");

    expect(built.where).toHaveBeenCalledWith(
      and(eq(users.id, "user-1"), isNull(users.deletedAt)),
    );
  });

  it("left-joins preferences and subscriptions so a prefs-less/free user still resolves", async () => {
    const built = buildSelectChain([]);

    await fetchProfileVisibility(built.chain as unknown as Database, "user-1");

    expect(built.leftJoin).toHaveBeenCalledTimes(2);
    expect(built.innerJoin).not.toHaveBeenCalled();
  });

  it("defaults a prefs-less profile to private (coalesce publicProfile to false)", async () => {
    const built = buildSelectChain([]);
    await fetchProfileVisibility(built.chain as unknown as Database, "user-1");
    const selection = built.select.mock.calls[0][0] as Record<string, unknown>;
    const publicProfileSql = renderSelectField(selection, "publicProfile");
    expect(publicProfileSql).toMatch(
      /coalesce\("?user_preferences"?\."?public_profile"?,\s*false\)/,
    );
  });

  it("selects no COUNT subqueries (the whole point of this lean sibling)", async () => {
    const built = buildSelectChain([]);
    await fetchProfileVisibility(built.chain as unknown as Database, "user-1");
    const selection = built.select.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(selection).sort()).toEqual([
      "publicProfile",
      "subscriptionPlan",
      "subscriptionStatus",
      "userId",
    ]);
  });
});

describe("fetchFollowers", () => {
  it("returns the mapped public followers with hasMore false under the cap", async () => {
    const rows = [
      { userId: "user-2", displayName: "Marco", handle: "marco" },
      { userId: "user-3", displayName: null, handle: "nina" },
    ];
    const built = buildSelectChain(rows);

    const result = await fetchFollowers(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result).toEqual({ followers: rows, hasMore: false });
  });

  it("signals hasMore and trims to the page size when an extra row comes back", async () => {
    // The query fetches PAGE_SIZE + 1; the extra row means "more exist".
    const rows = Array.from(
      { length: FOLLOWERS_PAGE_SIZE + 1 },
      (_, index) => ({
        userId: `user-${index}`,
        displayName: `Traveler ${index}`,
        handle: `t${index}`,
      }),
    );
    const built = buildSelectChain(rows);

    const result = await fetchFollowers(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result.hasMore).toBe(true);
    expect(result.followers).toHaveLength(FOLLOWERS_PAGE_SIZE);
  });

  it("filters to public, non-deleted followers of the target user", async () => {
    const built = buildSelectChain([]);

    await fetchFollowers(built.chain as unknown as Database, "user-1");

    // These predicates are the whole privacy contract: they keep private and
    // soft-deleted accounts out of another user's followers list.
    expect(built.where).toHaveBeenCalledWith(
      and(eq(follows.followeeId, "user-1"), publiclyVisibleAuthorCondition()),
    );
  });

  it("orders by most-recent follow and caps the result set", async () => {
    const built = buildSelectChain([]);

    await fetchFollowers(built.chain as unknown as Database, "user-1");

    // Assert the ordering itself: flipping desc→asc would silently return the
    // oldest followers instead of the most recent.
    expect(built.orderBy).toHaveBeenCalledWith(desc(follows.createdAt));
    // One extra row is fetched to detect hasMore.
    expect(built.limit).toHaveBeenCalledWith(FOLLOWERS_PAGE_SIZE + 1);
  });

  it("returns an empty page when the user has no public followers", async () => {
    const built = buildSelectChain([]);

    const result = await fetchFollowers(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result).toEqual({ followers: [], hasMore: false });
  });
});

describe("fetchPublicTrips", () => {
  it("returns the mapped public trips with hasMore false under the cap", async () => {
    const rows = [
      {
        id: "trip-1",
        name: "Iceland Ring Road",
        status: "past",
        startDate: new Date("2024-06-01"),
        endDate: new Date("2024-06-14"),
      },
    ];
    const built = buildSelectChain(rows);

    const result = await fetchPublicTrips(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result).toEqual({ trips: rows, hasMore: false });
  });

  it("signals hasMore and trims to the page size when an extra row comes back", async () => {
    const rows = Array.from(
      { length: PROFILE_TRIPS_PAGE_SIZE + 1 },
      (_, index) => ({
        id: `trip-${index}`,
        name: `Trip ${index}`,
        status: "past",
        startDate: null,
        endDate: null,
      }),
    );
    const built = buildSelectChain(rows);

    const result = await fetchPublicTrips(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result.hasMore).toBe(true);
    expect(result.trips).toHaveLength(PROFILE_TRIPS_PAGE_SIZE);
  });

  it("filters to the target user's public trips", async () => {
    const built = buildSelectChain([]);

    await fetchPublicTrips(built.chain as unknown as Database, "user-1");

    // The whole privacy contract for this list: only this user's trips, and
    // only the ones they marked public — a private trip must never leak here.
    expect(built.where).toHaveBeenCalledWith(
      and(eq(trips.userId, "user-1"), eq(trips.visibility, VISIBILITY.PUBLIC)),
    );
  });

  it("orders by most-recent and caps the result set", async () => {
    const built = buildSelectChain([]);

    await fetchPublicTrips(built.chain as unknown as Database, "user-1");

    expect(built.orderBy).toHaveBeenCalledWith(
      desc(trips.createdAt),
      desc(trips.id),
    );
    // One extra row is fetched to detect hasMore.
    expect(built.limit).toHaveBeenCalledWith(PROFILE_TRIPS_PAGE_SIZE + 1);
  });

  it("returns an empty page when the user has no public trips", async () => {
    const built = buildSelectChain([]);

    const result = await fetchPublicTrips(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result).toEqual({ trips: [], hasMore: false });
  });
});

describe("fetchPublicGuides", () => {
  it("returns the mapped public guides with hasMore false under the cap", async () => {
    const rows = [
      {
        id: "guide-1",
        title: "Tokyo on foot",
        readTimeMinutes: 8,
        likeCount: 3,
      },
    ];
    const built = buildSelectChain(rows);

    const result = await fetchPublicGuides(
      built.chain as unknown as Database,
      "user-1",
      "viewer-1",
    );

    expect(result).toEqual({ guides: rows, hasMore: false });
  });

  it("signals hasMore and trims to the page size when an extra row comes back", async () => {
    const rows = Array.from(
      { length: PROFILE_GUIDES_PAGE_SIZE + 1 },
      (_, index) => ({
        id: `guide-${index}`,
        title: `Guide ${index}`,
        readTimeMinutes: 5,
        likeCount: 0,
      }),
    );
    const built = buildSelectChain(rows);

    const result = await fetchPublicGuides(
      built.chain as unknown as Database,
      "user-1",
      "viewer-1",
    );

    expect(result.hasMore).toBe(true);
    expect(result.guides).toHaveLength(PROFILE_GUIDES_PAGE_SIZE);
  });

  it("filters to the target user's public guides from a discoverable author, for a non-owner viewer", async () => {
    const built = buildSelectChain([]);

    await fetchPublicGuides(
      built.chain as unknown as Database,
      "user-1",
      "viewer-1",
    );

    // Matches the read rule guide-queries.loadReadableGuide enforces on a
    // direct read, so nothing listed here 404s when opened: this user's
    // guides, public visibility, and the author must still clear the
    // discoverability bar (public profile, entitled, showOnExplore).
    expect(built.where).toHaveBeenCalledWith(
      and(
        eq(guides.userId, "user-1"),
        eq(guides.visibility, VISIBILITY.PUBLIC),
        discoverableAuthorCondition(),
      ),
    );
  });

  it("omits the discoverability gate when the owner views their own guides", async () => {
    const built = buildSelectChain([]);

    // Same user as both target and viewer: the owner can always open their own
    // guide (loadReadableGuide), so the discoverability requirement — which
    // exists only to keep a non-owner from hitting a 404 — must not apply.
    await fetchPublicGuides(
      built.chain as unknown as Database,
      "user-1",
      "user-1",
    );

    expect(built.where).toHaveBeenCalledWith(
      and(
        eq(guides.userId, "user-1"),
        eq(guides.visibility, VISIBILITY.PUBLIC),
      ),
    );
  });

  it("left-joins user_preferences so an owner without a preferences row still sees their own guides", async () => {
    const built = buildSelectChain([]);

    await fetchPublicGuides(
      built.chain as unknown as Database,
      "user-1",
      "user-1",
    );

    // An inner join here would drop every guide for an owner who never opened
    // settings (no user_preferences row) even though the discoverability gate
    // is skipped for their own view.
    expect(built.innerJoin).toHaveBeenCalledTimes(1);
    expect(built.leftJoin).toHaveBeenCalledTimes(1);
  });

  it("orders by most-recent and caps the result set", async () => {
    const built = buildSelectChain([]);

    await fetchPublicGuides(
      built.chain as unknown as Database,
      "user-1",
      "viewer-1",
    );

    expect(built.orderBy).toHaveBeenCalledWith(
      desc(guides.createdAt),
      desc(guides.id),
    );
    // One extra row is fetched to detect hasMore.
    expect(built.limit).toHaveBeenCalledWith(PROFILE_GUIDES_PAGE_SIZE + 1);
  });

  it("returns an empty page when the user has no public guides", async () => {
    const built = buildSelectChain([]);

    const result = await fetchPublicGuides(
      built.chain as unknown as Database,
      "user-1",
      "viewer-1",
    );

    expect(result).toEqual({ guides: [], hasMore: false });
  });
});

describe("requireViewableProfile", () => {
  // The raw row shape fetchProfileRow reads before it derives effectivelyPublic
  // and strips the subscription fields — so these rows carry the subscription
  // status/plan, letting the visibility rule be exercised end to end.
  function rawProfileRow(params: {
    publicProfile: boolean;
    status?: (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];
    plan?: (typeof PLAN)[keyof typeof PLAN];
  }) {
    return {
      userId: "target-1",
      displayName: "Elsa",
      handle: "elsa_far",
      homeBase: null,
      bio: null,
      publicProfile: params.publicProfile,
      subscriptionStatus: params.status ?? null,
      subscriptionPlan: params.plan ?? null,
      followerCount: 0,
      followingCount: 0,
      placeCount: 0,
    };
  }

  it("returns a public profile to another viewer when the subscription entitles it", async () => {
    const built = buildSelectChain([
      rawProfileRow({
        publicProfile: true,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        plan: PLAN.NOMAD,
      }),
    ]);

    const result = await requireViewableProfile(
      built.chain as unknown as Database,
      "viewer-1",
      "target-1",
    );

    expect(result).toMatchObject({
      userId: "target-1",
      publicProfile: true,
      effectivelyPublic: true,
    });
  });

  it("throws 404 to another viewer when opted in but the subscription is past_due", async () => {
    const built = buildSelectChain([
      rawProfileRow({
        publicProfile: true,
        status: SUBSCRIPTION_STATUS.PAST_DUE,
        plan: PLAN.NOMAD,
      }),
    ]);

    await expect(
      requireViewableProfile(
        built.chain as unknown as Database,
        "viewer-1",
        "target-1",
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("still shows a lapsed (past_due) public profile to its owner", async () => {
    const built = buildSelectChain([
      rawProfileRow({
        publicProfile: true,
        status: SUBSCRIPTION_STATUS.PAST_DUE,
        plan: PLAN.NOMAD,
      }),
    ]);

    const result = await requireViewableProfile(
      built.chain as unknown as Database,
      "target-1",
      "target-1",
    );

    expect(result).toMatchObject({
      userId: "target-1",
      effectivelyPublic: false,
    });
  });

  it("returns a private profile to its owner", async () => {
    const built = buildSelectChain([rawProfileRow({ publicProfile: false })]);

    const result = await requireViewableProfile(
      built.chain as unknown as Database,
      "target-1",
      "target-1",
    );

    expect(result).toMatchObject({ userId: "target-1" });
  });

  it("throws 404 for a private profile viewed by someone else", async () => {
    const built = buildSelectChain([rawProfileRow({ publicProfile: false })]);

    await expect(
      requireViewableProfile(
        built.chain as unknown as Database,
        "viewer-1",
        "target-1",
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 404 when the profile does not exist", async () => {
    const built = buildSelectChain([]);

    await expect(
      requireViewableProfile(
        built.chain as unknown as Database,
        "viewer-1",
        "missing",
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("requireViewableProfileTarget", () => {
  const mockRequireUser = vi.mocked(requireUser);
  const mockGetDb = vi.mocked(getDb);

  beforeEach(() => {
    mockRequireUser.mockReset();
    mockGetDb.mockReset();
  });

  function stubRouterParam(value: string | undefined) {
    vi.stubGlobal("getRouterParam", vi.fn().mockReturnValue(value));
  }

  it("resolves the database and target user id once the visibility guard passes", async () => {
    const built = buildSelectChain([
      {
        userId: "target-1",
        publicProfile: true,
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        subscriptionPlan: PLAN.NOMAD,
      },
    ]);
    mockRequireUser.mockReturnValue("viewer-1");
    mockGetDb.mockReturnValue(
      built.chain as unknown as ReturnType<typeof getDb>,
    );
    stubRouterParam("target-1");

    const result = await requireViewableProfileTarget(
      {} as Parameters<typeof requireViewableProfileTarget>[0],
    );

    expect(result).toEqual({
      database: built.chain,
      targetUserId: "target-1",
      viewerId: "viewer-1",
    });
  });

  it("throws 404 when the target profile is private to the viewer", async () => {
    const built = buildSelectChain([
      {
        userId: "target-1",
        publicProfile: false,
        subscriptionStatus: null,
        subscriptionPlan: null,
      },
    ]);
    mockRequireUser.mockReturnValue("viewer-1");
    mockGetDb.mockReturnValue(
      built.chain as unknown as ReturnType<typeof getDb>,
    );
    stubRouterParam("target-1");

    await expect(
      requireViewableProfileTarget(
        {} as Parameters<typeof requireViewableProfileTarget>[0],
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("uses the lean visibility-only query, not the counts-laden fetchProfileRow", async () => {
    const built = buildSelectChain([
      {
        userId: "target-1",
        publicProfile: true,
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        subscriptionPlan: PLAN.NOMAD,
      },
    ]);
    mockRequireUser.mockReturnValue("viewer-1");
    mockGetDb.mockReturnValue(
      built.chain as unknown as ReturnType<typeof getDb>,
    );
    stubRouterParam("target-1");

    await requireViewableProfileTarget(
      {} as Parameters<typeof requireViewableProfileTarget>[0],
    );

    // A regression back to fetchProfileRow here would recompute (and
    // discard) three correlated COUNT subqueries on every followers/trips/
    // guides request — this pins the lean selection shape so that can't
    // silently creep back in.
    const selection = built.select.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(selection).sort()).toEqual([
      "publicProfile",
      "subscriptionPlan",
      "subscriptionStatus",
      "userId",
    ]);
  });

  it("propagates the 401 when requireUser throws, without touching the database", async () => {
    mockRequireUser.mockImplementation(() => {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    });
    stubRouterParam("target-1");

    await expect(
      requireViewableProfileTarget(
        {} as Parameters<typeof requireViewableProfileTarget>[0],
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("throws 400 when the route id param is missing", async () => {
    mockRequireUser.mockReturnValue("viewer-1");
    stubRouterParam(undefined);

    await expect(
      requireViewableProfileTarget(
        {} as Parameters<typeof requireViewableProfileTarget>[0],
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});
