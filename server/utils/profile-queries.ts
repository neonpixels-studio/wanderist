/**
 * Query utilities for public user profiles, follower lists, and the public
 * trips/guides shown on a profile.
 *
 * All functions accept a pre-built database instance and the relevant user IDs
 * so they can be tested in isolation without mocking module-level singletons.
 * The `fetch*` functions only read and never throw; `requireViewableProfile`
 * and `requireViewableProfileTarget` are the exception — both route through
 * `assertProfileViewable`, the single source of the profile visibility rule
 * (shared by every profile endpoint so the check cannot drift), and throw 404.
 */

import type { H3Event } from "h3";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/index";
import {
  follows,
  guides,
  subscriptions,
  trips,
  TRIP_STATUS,
  users,
  userPreferences,
  VISIBILITY,
} from "../db/schema";
import { requireUser } from "./auth";
import { requireRouterParam } from "./db-helpers";
import { discoverableAuthorCondition } from "./discover-queries";
import {
  publiclyVisibleAuthorCondition,
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

export interface ProfileVisibility {
  userId: string;
  effectivelyPublic: boolean;
}

// Maximum trips/guides returned by a single profile content request. Mirrors
// FOLLOWERS_PAGE_SIZE: one extra row is fetched internally to detect
// `hasMore` without a separate COUNT query.
export const PROFILE_TRIPS_PAGE_SIZE = 20;
export const PROFILE_GUIDES_PAGE_SIZE = 20;

export interface PublicTripSummary {
  id: string;
  name: string;
  status: (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS];
  startDate: Date | null;
  endDate: Date | null;
}

export interface PublicGuideSummary {
  id: string;
  title: string;
  readTimeMinutes: number;
  likeCount: number;
}

export interface TripsPage {
  trips: PublicTripSummary[];
  hasMore: boolean;
}

export interface GuidesPage {
  guides: PublicGuideSummary[];
  hasMore: boolean;
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
 * false via subscriptionEntitlesPublicProfile. subscriptions.userId is the
 * table's primary key (1:1 with users), so this join contributes at most one
 * row and the entitlement read here matches the EXISTS in
 * entitledToPublicProfileCondition that the collection paths use — no ORDER BY
 * is needed to make the single row deterministic. The raw subscription fields
 * are consumed here and never returned, so a viewer never learns another user's
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
 * Lightweight sibling of `fetchProfileRow`: resolves only whether a profile
 * exists and is effectively public, without the three correlated `COUNT`
 * subqueries `fetchProfileRow` computes for the profile-detail response.
 *
 * `requireViewableProfileTarget` — the preamble every `/api/users/[id]/*`
 * sub-resource list endpoint (followers, trips, guides) calls purely as a
 * visibility gate — never renders those counts. Routing it through the full
 * `fetchProfileRow` would recompute (and discard) the follower/following/place
 * counts on every one of those requests; a single profile page load already
 * issues one such request per sub-resource, so the waste multiplies with
 * every sub-resource this profile page grows. `fetchProfileRow` remains the
 * one the profile-detail endpoint (`/api/users/[id]`) uses, since it actually
 * returns the counts.
 */
export async function fetchProfileVisibility(
  database: Database,
  userId: string,
): Promise<ProfileVisibility | null> {
  const rows = await database
    .select({
      userId: users.id,
      publicProfile: sql<boolean>`coalesce(${userPreferences.publicProfile}, false)`,
      subscriptionStatus: subscriptions.status,
      subscriptionPlan: subscriptions.plan,
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

  const entitled = subscriptionEntitlesPublicProfile({
    plan: row.subscriptionPlan,
    status: row.subscriptionStatus,
  });

  return {
    userId: row.userId,
    effectivelyPublic: row.publicProfile && entitled,
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
      and(eq(follows.followeeId, userId), publiclyVisibleAuthorCondition()),
    )
    .orderBy(desc(follows.createdAt))
    .limit(FOLLOWERS_PAGE_SIZE + 1);

  return {
    followers: rows.slice(0, FOLLOWERS_PAGE_SIZE),
    hasMore: rows.length > FOLLOWERS_PAGE_SIZE,
  };
}

/**
 * Returns one page of `userId`'s public trips, most recent first, capped at
 * PROFILE_TRIPS_PAGE_SIZE, plus a `hasMore` flag. Callers must have already
 * established via `requireViewableProfile` that the viewer may see this
 * profile at all — this only adds the per-item filter (`visibility public`).
 *
 * Unlike guide reads (see `fetchPublicGuides`), a public trip's non-owner read
 * rule (`loadReadableTrip`) is gated purely on `visibility = public`, with no
 * additional author-discoverability requirement — so this list needs no extra
 * join to stay consistent with what `/api/trips/[id]` will actually serve.
 */
export async function fetchPublicTrips(
  database: Database,
  userId: string,
): Promise<TripsPage> {
  // Fetch one extra row so `hasMore` is known without a separate COUNT query.
  const rows = await database
    .select({
      id: trips.id,
      name: trips.name,
      status: trips.status,
      startDate: trips.startDate,
      endDate: trips.endDate,
    })
    .from(trips)
    .where(
      and(eq(trips.userId, userId), eq(trips.visibility, VISIBILITY.PUBLIC)),
    )
    .orderBy(desc(trips.createdAt), desc(trips.id))
    .limit(PROFILE_TRIPS_PAGE_SIZE + 1);

  return {
    trips: rows.slice(0, PROFILE_TRIPS_PAGE_SIZE),
    hasMore: rows.length > PROFILE_TRIPS_PAGE_SIZE,
  };
}

/**
 * Returns one page of `userId`'s public guides, most recent first, capped at
 * PROFILE_GUIDES_PAGE_SIZE, plus a `hasMore` flag. Callers must have already
 * established via `requireViewableProfile` that the viewer may see this
 * profile at all.
 *
 * A guide's non-owner read rule (`loadReadableGuide`/`isReadableByNonOwner` in
 * guide-queries.ts) additionally requires the author to be "discoverable"
 * (public profile, entitled, AND opted into `showOnExplore`) — explore has
 * historically been the only place a non-owner obtains a guide id, so that
 * gate never had to consider the profile page. This list applies the same
 * `discoverableAuthorCondition` so a guide never appears here only to 404 when
 * opened by someone else — every card a non-owner sees is guaranteed openable.
 *
 * That gate is skipped when `viewerId === userId`: the owner can always open
 * their own guide at any visibility (`loadReadableGuide` returns it
 * unconditionally), so applying `discoverableAuthorCondition` to a self-view
 * would only hide the owner's own public guides from their own profile (e.g.
 * a free-tier author, or one with `showOnExplore` off) for no reason — the
 * "never 404 on open" rationale doesn't apply to a view the owner controls.
 * `userPreferences` is left-joined (not inner) so an owner who never opened
 * settings still sees their own guides in the self-view case, where that join
 * is otherwise unused.
 */
export async function fetchPublicGuides(
  database: Database,
  userId: string,
  viewerId: string,
): Promise<GuidesPage> {
  const authorMustBeDiscoverable =
    viewerId === userId ? undefined : discoverableAuthorCondition();

  // Fetch one extra row so `hasMore` is known without a separate COUNT query.
  const rows = await database
    .select({
      id: guides.id,
      title: guides.title,
      readTimeMinutes: guides.readTimeMinutes,
      likeCount: guides.likeCount,
    })
    .from(guides)
    .innerJoin(users, eq(guides.userId, users.id))
    .leftJoin(userPreferences, eq(guides.userId, userPreferences.userId))
    .where(
      and(
        eq(guides.userId, userId),
        eq(guides.visibility, VISIBILITY.PUBLIC),
        authorMustBeDiscoverable,
      ),
    )
    .orderBy(desc(guides.createdAt), desc(guides.id))
    .limit(PROFILE_GUIDES_PAGE_SIZE + 1);

  return {
    guides: rows.slice(0, PROFILE_GUIDES_PAGE_SIZE),
    hasMore: rows.length > PROFILE_GUIDES_PAGE_SIZE,
  };
}

/**
 * The single source of the profile visibility rule: throws 404 when `profile`
 * is missing, or when it isn't effectively public and the viewer isn't its
 * owner. Shared by `requireViewableProfile` (full row, used by the
 * profile-detail endpoint) and `requireViewableProfileTarget` (lean
 * visibility-only row, used by the sub-resource list endpoints) so the rule
 * itself cannot drift between the two even though they fetch different
 * shapes. Narrows `profile` to non-null for the caller via the `asserts`
 * return type.
 */
function assertProfileViewable<T extends { effectivelyPublic: boolean }>(
  profile: T | null,
  currentUserId: string,
  targetUserId: string,
): asserts profile is T {
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: "Profile not found" });
  }

  // A profile that isn't effectively public (never opted in, or opted in but
  // the subscription that entitled it has lapsed) is visible only to its owner
  // — never leak it to others.
  if (!profile.effectivelyPublic && currentUserId !== targetUserId) {
    throw createError({ statusCode: 404, statusMessage: "Profile not found" });
  }
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

  assertProfileViewable(profile, currentUserId, targetUserId);

  return profile;
}

/**
 * Resolves the database, authenticated viewer, and the `id` route param, then
 * enforces the same visibility rule as `requireViewableProfile` — via the
 * lean `fetchProfileVisibility` rather than the counts-laden `fetchProfileRow`
 * — before any `/api/users/[id]/*` sub-resource list is read. Every such
 * endpoint (followers, trips, guides) needs this identical preamble;
 * consolidating it here means a new one can't accidentally skip the
 * visibility check. Returns `viewerId` too (not just `targetUserId`) so a
 * list that treats the owner differently from any other viewer — see
 * `fetchPublicGuides` — can do so without re-deriving the authenticated user.
 */
export async function requireViewableProfileTarget(
  event: H3Event,
): Promise<{ database: Database; targetUserId: string; viewerId: string }> {
  const viewerId = requireUser(event);
  const targetUserId = requireRouterParam(event, "id");
  const database = getDb();

  const profile = await fetchProfileVisibility(database, targetUserId);
  assertProfileViewable(profile, viewerId, targetUserId);

  return { database, targetUserId, viewerId };
}
