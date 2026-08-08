/**
 * Unit tests for profile-queries.ts
 *
 * DB interactions are mocked. Because the mock chain resolves the same rows
 * regardless of the predicates, the privacy-critical filters are asserted
 * explicitly against the arguments passed to `.where()` — otherwise removing
 * `publicProfile`/`deletedAt` would silently pass while leaking private data.
 */

import { describe, it, expect, vi } from "vitest";
import { and, desc, eq, isNull } from "drizzle-orm";
import { stubNitroGlobals } from "../test-utils";
import {
  fetchProfileRow,
  fetchFollowers,
  requireViewableProfile,
  FOLLOWERS_PAGE_SIZE,
} from "../../../server/utils/profile-queries";
import type { Database } from "../../../server/utils/profile-queries";
import { follows, users, userPreferences } from "../../../server/db/schema";

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

describe("fetchProfileRow", () => {
  it("maps the row and coerces subquery counts to numbers", async () => {
    const rawRow = {
      userId: "user-1",
      displayName: "Elsa",
      handle: "elsa_far",
      homeBase: "Reykjavik",
      bio: "Cold-water swimmer",
      publicProfile: true,
      followerCount: "12",
      followingCount: "4",
      placeCount: "37",
    };
    const built = buildSelectChain([rawRow]);

    const result = await fetchProfileRow(
      built.chain as unknown as Database,
      "user-1",
    );

    expect(result).toEqual({
      userId: "user-1",
      displayName: "Elsa",
      handle: "elsa_far",
      homeBase: "Reykjavik",
      bio: "Cold-water swimmer",
      publicProfile: true,
      followerCount: 12,
      followingCount: 4,
      placeCount: 37,
    });
  });

  it("scopes the query to the user id and excludes soft-deleted users", async () => {
    const built = buildSelectChain([]);

    await fetchProfileRow(built.chain as unknown as Database, "user-1");

    expect(built.where).toHaveBeenCalledWith(
      and(eq(users.id, "user-1"), isNull(users.deletedAt)),
    );
  });

  it("left-joins preferences so a user without a prefs row still resolves", async () => {
    const built = buildSelectChain([]);

    await fetchProfileRow(built.chain as unknown as Database, "user-1");

    // An inner join here would 404 a brand-new user on their own profile.
    expect(built.leftJoin).toHaveBeenCalledTimes(1);
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
      and(
        eq(follows.followeeId, "user-1"),
        eq(userPreferences.publicProfile, true),
        isNull(users.deletedAt),
      ),
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

describe("requireViewableProfile", () => {
  function publicRow(publicProfile: boolean) {
    return {
      userId: "target-1",
      displayName: "Elsa",
      handle: "elsa_far",
      homeBase: null,
      bio: null,
      publicProfile,
      followerCount: 0,
      followingCount: 0,
      placeCount: 0,
    };
  }

  it("returns a public profile to another viewer", async () => {
    const built = buildSelectChain([publicRow(true)]);

    const result = await requireViewableProfile(
      built.chain as unknown as Database,
      "viewer-1",
      "target-1",
    );

    expect(result).toMatchObject({ userId: "target-1", publicProfile: true });
  });

  it("returns a private profile to its owner", async () => {
    const built = buildSelectChain([publicRow(false)]);

    const result = await requireViewableProfile(
      built.chain as unknown as Database,
      "target-1",
      "target-1",
    );

    expect(result).toMatchObject({ userId: "target-1" });
  });

  it("throws 404 for a private profile viewed by someone else", async () => {
    const built = buildSelectChain([publicRow(false)]);

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
