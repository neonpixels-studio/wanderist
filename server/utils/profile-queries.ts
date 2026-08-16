/**
 * Query utilities for public user profiles and follower lists.
 *
 * All functions accept a pre-built database instance and the relevant user IDs
 * so they can be tested in isolation without mocking module-level singletons.
 * The `fetch*` functions only read and never throw; `requireViewableProfile` is
 * the one exception — it is the single source of the profile visibility rule
 * (shared by every profile endpoint so the check cannot drift) and throws a 404.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { getDb } from "../db/index";
import { follows, subscriptions, users, userPreferences } from "../db/schema";
import {
  entitledToPublicProfileCondition,
  subscriptionEntitlesPublicProfile,
} from "./publicVisibility";

export type Database = ReturnType<typeof getDb>;

// Maximum followers returned by a single followers-list request. One extra row
// is fetched internally to detect (and signal via `hasMore`) that more exist.
export const FOLLOWERS_PAGE_SIZE = 50;

export interface FollowersPage {
  followers: PublicPerson[];
  hasMore: boolean;
}

export interface ProfileRow {
  userId: string;
  displayName: string | null;
  handle: string | null;
  homeBase: string | null;
  bio: string | null;
  // The stored opt-in flag as saved in settings.
  publicProfile: boolean;
  // The opt-in AND the owner's effective plan still entitling them to a public
  // profile. This is the field visibility is enforced on — a lapsed/paused
  // subscriber keeps publicProfile `true` but is no longer effectivelyPublic.
  effectivelyPublic: boolean;
  followerCount: number;
  followingCount: number;
  placeCount: number;
}

export interface PublicPerson {
  userId: string;
  displayName: string | null;
  handle: string | null;
}

/**
 * Loads a user's profile row plus denormalised follower/following/place counts
 * in a single query. Returns null when the user does not exist or is
 * soft-deleted. The preferences table is left-joined (not inner-joined) so a
 * user who has never opened settings still resolves a row and can view their
 * own profile; `publicProfile` coalesces to false, so that profile stays
 * private to everyone else until they opt in. Both the opt-in and the derived
 * `effectivelyPublic` are returned so the caller (requireViewableProfile) can
 * enforce visibility on the effective entitlement.
 *
 * The subscriptions table is left-joined (not inner) so a free user with no
 * subscription row still resolves; a null status/plan yields effectivelyPublic
 * false via subscriptionEntitlesPublicProfile. The raw subscription fields are
 * consumed here and never returned, so a viewer never learns another user's
 * billing status.
 *
 * The follower-count subquery is served by the `follows_followee_id_idx` index.
 */
export async function fetchProfileRow(
  database: Database,
  userId: string,
): Promise<ProfileRow | null> {
  const rows = await database
    .select({
      userId: users.id,
      displayName: userPreferences.displayName,
      handle: userPreferences.handle,
      homeBase: userPreferences.homeBase,
      bio: userPreferences.bio,
      publicProfile: sql<boolean>`coalesce(${userPreferences.publicProfile}, false)`,
      subscriptionStatus: subscriptions.status,
      subscriptionPlan: subscriptions.plan,
      // Counts exclude soft-deleted counterparties: a follower/followee whose
      // account is pending purge (deleted_at set) should not inflate the totals,
      // so the count stays consistent with what the followers list can show.
      followerCount: sql<number>`(
        SELECT COUNT(*) FROM follows
        JOIN users AS follower_users ON follower_users.id = follows.follower_id
        WHERE follows.followee_id = ${users.id} AND follower_users.deleted_at IS NULL
      )`,
      followingCount: sql<number>`(
        SELECT COUNT(*) FROM follows
        JOIN users AS followee_users ON followee_users.id = follows.followee_id
        WHERE follows.follower_id = ${users.id} AND followee_users.deleted_at IS NULL
      )`,
      // places has no soft-delete or visibility column (see schema.ts), so a
      // plain count is already complete — no filter needed, unlike the follow
      // counts above which join users to skip soft-deleted accounts.
      placeCount: sql<number>`(
        SELECT COUNT(*) FROM places WHERE places.user_id = ${users.id}
      )`,
    })
    .from(users)
    .leftJoin(userPreferences, eq(users.id, userPreferences.userId))
    .leftJoin(subscriptions, eq(users.id, subscriptions.userId))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  const { subscriptionStatus, subscriptionPlan, ...profile } = row;
  const entitled = subscriptionEntitlesPublicProfile({
    plan: subscriptionPlan,
    status: subscriptionStatus,
  });

  return {
    ...profile,
    effectivelyPublic: profile.publicProfile && entitled,
    followerCount: Number(row.followerCount),
    followingCount: Number(row.followingCount),
    placeCount: Number(row.placeCount),
  };
}

/**
 * Returns one page of public-profile followers of `userId`, most recent first,
 * capped at FOLLOWERS_PAGE_SIZE, plus a `hasMore` flag so a truncated list is
 * signalled rather than silently cut. Uses the `follows_followee_id_idx` index
 * via the `followee_id = userId` predicate. Private followers are omitted so a
 * private account is never leaked into someone else's followers list.
 *
 * Note: this list is intentionally narrower than `ProfileRow.followerCount`,
 * which counts every non-deleted follow row (public and private). The count
 * reflects true reach; the list respects each follower's own privacy.
 *
 * Filters on `publicProfile` (not `showOnExplore`), matching `searchPeople` in
 * search-queries.ts: a follower list is a look-up of an existing connection,
 * like search, not algorithmic promotion like the explore surfaces (which also
 * gate on `showOnExplore`). Opting out of explore does not hide you from the
 * followers list of someone you chose to follow.
 */
export async function fetchFollowers(
  database: Database,
  userId: string,
): Promise<FollowersPage> {
  // Fetch one extra row so `hasMore` is known without a separate COUNT query.
  const rows = await database
    .select({
      userId: users.id,
      displayName: userPreferences.displayName,
      handle: userPreferences.handle,
    })
    .from(follows)
    .innerJoin(users, eq(follows.followerId, users.id))
    .innerJoin(userPreferences, eq(follows.followerId, userPreferences.userId))
    .where(
      and(
        eq(follows.followeeId, userId),
        eq(userPreferences.publicProfile, true),
        entitledToPublicProfileCondition(),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(desc(follows.createdAt))
    .limit(FOLLOWERS_PAGE_SIZE + 1);

  return {
    followers: rows.slice(0, FOLLOWERS_PAGE_SIZE),
    hasMore: rows.length > FOLLOWERS_PAGE_SIZE,
  };
}

/**
 * Loads a profile and enforces visibility in one place. Throws 404 when the
 * user does not exist, is soft-deleted, or is private and viewed by anyone but
 * its owner. Returns the row so the caller can use it. Every profile endpoint
 * routes through here so the privacy rule stays identical across them.
 */
export async function requireViewableProfile(
  database: Database,
  currentUserId: string,
  targetUserId: string,
): Promise<ProfileRow> {
  const profile = await fetchProfileRow(database, targetUserId);

  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: "Profile not found" });
  }

  // A profile that isn't effectively public (never opted in, or opted in but
  // the subscription that entitled it has lapsed) is visible only to its owner
  // — never leak it to others.
  if (!profile.effectivelyPublic && currentUserId !== targetUserId) {
    throw createError({ statusCode: 404, statusMessage: "Profile not found" });
  }

  return profile;
}
