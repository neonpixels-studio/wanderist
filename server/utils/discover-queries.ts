/**
 * Query utilities for the explore/discover page.
 *
 * All functions accept a pre-built database instance and (where relevant) the
 * requesting userId so they can be tested in isolation without mocking
 * module-level singletons. Auth scoping is enforced here, not in the handlers.
 */

import { count, desc, eq, isNull, sql, and, notInArray } from "drizzle-orm";
import type { getDb } from "../db/index";
import {
  trips,
  places,
  users,
  userPreferences,
  follows,
  guides,
  VISIBILITY,
} from "../db/schema";
import { entitledToPublicProfileCondition } from "./publicVisibility";

export type Database = ReturnType<typeof getDb>;

/**
 * The predicate that makes a content author eligible to surface publicly: their
 * account is live (not soft-deleted), their profile is public, and they have
 * opted into explore. Shared so the single-guide read path
 * (guide-queries.loadReadableGuide) can't drift from what actually appears on
 * explore — a guide must never stay readable by id after its author fails this.
 * Callers `and()` it with their own table-specific conditions (e.g. the
 * relevant `visibility = public`).
 *
 * `publicProfile` is the stored opt-in; entitledToPublicProfileCondition adds
 * the *effective* check so a lapsed/paused subscriber whose opt-in still reads
 * true is not surfaced.
 */
export function discoverableAuthorCondition() {
  return and(
    isNull(users.deletedAt),
    eq(userPreferences.publicProfile, true),
    eq(userPreferences.showOnExplore, true),
    entitledToPublicProfileCondition(),
  );
}

// Maximum result counts for each discovery section.
const FEATURED_TRIP_LIMIT = 6;
const TRENDING_PLACES_LIMIT = 8;
const GUIDE_LIMIT = 6;
const SUGGESTED_PEOPLE_LIMIT = 6;

// Number of days that defines "recent activity" for trending ranking.
const TRENDING_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface FeaturedTrip {
  id: string;
  name: string;
  status: string;
  stopCount: number;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
}

export interface TrendingPlace {
  name: string;
  country: string | null;
  category: string | null;
  saveCount: number;
  recentSaveCount: number;
}

export interface DiscoverGuide {
  id: string;
  title: string;
  readTimeMinutes: number;
  likeCount: number;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
}

export interface SuggestedPerson {
  userId: string;
  displayName: string | null;
  handle: string | null;
  homeBase: string | null;
  placeCount: number;
}

/**
 * Returns recently created public trips from users with public profiles and
 * showOnExplore enabled, ordered by creation date descending. Each result
 * includes the stop count (via a subquery) so the explore card can display it.
 */
export async function fetchFeaturedTrips(
  database: Database,
): Promise<FeaturedTrip[]> {
  const rows = await database
    .select({
      id: trips.id,
      name: trips.name,
      status: trips.status,
      ownerHandle: userPreferences.handle,
      ownerDisplayName: userPreferences.displayName,
      stopCount: sql<number>`(
        SELECT COUNT(*) FROM trip_stops WHERE trip_stops.trip_id = ${trips.id}
      )`,
    })
    .from(trips)
    .innerJoin(users, eq(trips.userId, users.id))
    .innerJoin(userPreferences, eq(trips.userId, userPreferences.userId))
    .where(
      and(
        eq(trips.visibility, VISIBILITY.PUBLIC),
        eq(userPreferences.publicProfile, true),
        eq(userPreferences.showOnExplore, true),
        isNull(users.deletedAt),
        entitledToPublicProfileCondition(),
      ),
    )
    .orderBy(desc(trips.createdAt))
    .limit(FEATURED_TRIP_LIMIT);

  return rows.map((row) => ({
    ...row,
    stopCount: Number(row.stopCount),
  }));
}

/**
 * Returns places trending across all users, ranked by recent-window save count
 * (last 30 days) then by all-time save count for tiebreaking. Places are
 * aggregated by (name, country, category) triple across all users so the same
 * real-world location accumulates saves from multiple users. Only considers
 * places from users with a public profile and showOnExplore enabled.
 *
 * When `category` is provided, results are filtered to that category only.
 */
export async function fetchTrendingPlaces(
  database: Database,
  category: string | null,
  now: Date = new Date(),
): Promise<TrendingPlace[]> {
  const windowStart = new Date(
    now.getTime() - TRENDING_WINDOW_DAYS * MS_PER_DAY,
  );

  const recentSaveCountExpr = sql<number>`COUNT(CASE WHEN ${places.createdAt} >= ${windowStart.toISOString()} THEN 1 END)`;

  const baseConditions = and(
    eq(userPreferences.publicProfile, true),
    eq(userPreferences.showOnExplore, true),
    isNull(users.deletedAt),
    entitledToPublicProfileCondition(),
  );

  const filterCondition = category
    ? and(baseConditions, eq(places.category, category))
    : baseConditions;

  const rows = await database
    .select({
      name: places.name,
      country: places.country,
      category: places.category,
      saveCount: count(places.id),
      recentSaveCount: recentSaveCountExpr,
    })
    .from(places)
    .innerJoin(users, eq(places.userId, users.id))
    .innerJoin(userPreferences, eq(places.userId, userPreferences.userId))
    .where(filterCondition)
    .groupBy(places.name, places.country, places.category)
    .orderBy(desc(recentSaveCountExpr), desc(count(places.id)))
    .limit(TRENDING_PLACES_LIMIT);

  return rows.map((row) => ({
    name: row.name,
    country: row.country,
    category: row.category,
    saveCount: Number(row.saveCount),
    recentSaveCount: Number(row.recentSaveCount),
  }));
}

/**
 * Returns public guides from users with public profiles and showOnExplore
 * enabled, ordered by like count descending. Each result includes the
 * author's handle and display name from user_preferences.
 */
export async function fetchGuides(
  database: Database,
): Promise<DiscoverGuide[]> {
  const rows = await database
    .select({
      id: guides.id,
      title: guides.title,
      readTimeMinutes: guides.readTimeMinutes,
      likeCount: guides.likeCount,
      ownerHandle: userPreferences.handle,
      ownerDisplayName: userPreferences.displayName,
    })
    .from(guides)
    .innerJoin(users, eq(guides.userId, users.id))
    .innerJoin(userPreferences, eq(guides.userId, userPreferences.userId))
    .where(
      and(
        eq(guides.visibility, VISIBILITY.PUBLIC),
        discoverableAuthorCondition(),
      ),
    )
    .orderBy(desc(guides.likeCount))
    .limit(GUIDE_LIMIT);

  return rows;
}

/**
 * Returns users the current user does not already follow, with public profiles
 * and showOnExplore enabled. Ordered by total place count descending so active
 * travellers surface first.
 */
export async function fetchSuggestedPeople(
  database: Database,
  currentUserId: string,
): Promise<SuggestedPerson[]> {
  const followedRows = await database
    .select({ followeeId: follows.followeeId })
    .from(follows)
    .where(eq(follows.followerId, currentUserId));

  const followedIds = followedRows.map((row) => row.followeeId);

  const placeCountSubquery = sql<number>`(
    SELECT COUNT(*) FROM places WHERE places.user_id = ${users.id}
  )`;

  const notFollowedAndNotSelf = and(
    eq(userPreferences.publicProfile, true),
    eq(userPreferences.showOnExplore, true),
    isNull(users.deletedAt),
    entitledToPublicProfileCondition(),
    notInArray(users.id, [...followedIds, currentUserId]),
  );

  const rows = await database
    .select({
      userId: users.id,
      displayName: userPreferences.displayName,
      handle: userPreferences.handle,
      homeBase: userPreferences.homeBase,
      placeCount: placeCountSubquery,
    })
    .from(users)
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(notFollowedAndNotSelf)
    .orderBy(desc(placeCountSubquery))
    .limit(SUGGESTED_PEOPLE_LIMIT);

  return rows.map((row) => ({
    ...row,
    placeCount: Number(row.placeCount),
  }));
}
