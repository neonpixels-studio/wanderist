import { count, eq, and, ne } from "drizzle-orm";
import { getDb } from "../db/index";
import {
  places,
  trips,
  media,
  userPreferences,
  TRIP_STATUS,
  PLAN,
  SUBSCRIPTION_STATUS,
} from "../db/schema";
import {
  getEffectivePlan,
  getSubscriptionForUser,
  type Plan,
} from "./subscriptions";

// Single source of truth for map style values — also imported by
// server/api/preferences.patch.ts so the "which styles exist" list and the
// "which styles this plan may use" list never drift apart.
export const MAP_STYLES = [
  "outdoors",
  "streets",
  "satellite",
  "light",
  "dark",
  "custom",
] as const;

export type MapStyle = (typeof MAP_STYLES)[number];

// `null` means unlimited.
interface PlanLimitSet {
  maxPlaces: number | null;
  maxActiveTrips: number | null;
  maxPhotos: number | null;
  mapStyles: readonly MapStyle[];
  instagramSyncAllowed: boolean;
  publicProfileAllowed: boolean;
}

// The advertised limits from the /pricing comparison table. Kept as one
// lookup table rather than scattered magic numbers so the pricing copy and
// server-side enforcement can't silently drift apart.
export const PLAN_LIMITS: Record<Plan, PlanLimitSet> = {
  [PLAN.DRIFTER]: {
    maxPlaces: 25,
    maxActiveTrips: 1,
    maxPhotos: 100,
    mapStyles: ["outdoors"],
    instagramSyncAllowed: false,
    publicProfileAllowed: false,
  },
  [PLAN.WANDERER]: {
    maxPlaces: null,
    maxActiveTrips: null,
    maxPhotos: null,
    mapStyles: MAP_STYLES,
    instagramSyncAllowed: true,
    publicProfileAllowed: false,
  },
  [PLAN.NOMAD]: {
    maxPlaces: null,
    maxActiveTrips: null,
    maxPhotos: null,
    mapStyles: MAP_STYLES,
    instagramSyncAllowed: true,
    publicProfileAllowed: true,
  },
};

function planDisplayName(plan: Plan): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** Throws 402 Payment Required if `currentCount()` has already reached `max`. `max: null` is unlimited. */
async function assertCountLimit(params: {
  max: number | null;
  currentCount: () => Promise<number>;
  resourceLabel: string;
  planName: string;
}): Promise<void> {
  if (params.max === null) {
    return;
  }
  const current = await params.currentCount();
  if (current >= params.max) {
    throw createError({
      statusCode: 402,
      statusMessage: `The ${params.planName} plan is limited to ${params.max} ${params.resourceLabel}. Upgrade to add more.`,
    });
  }
}

/** Throws 402 Payment Required if `allowed` is false. */
function assertFeatureAllowed(
  allowed: boolean,
  planName: string,
  featureLabel: string,
): void {
  if (!allowed) {
    throw createError({
      statusCode: 402,
      statusMessage: `${featureLabel} is not available on the ${planName} plan. Upgrade to unlock it.`,
    });
  }
}

async function countPlaceRows(userId: string): Promise<number> {
  const database = getDb();
  const rows = await database
    .select({ value: count() })
    .from(places)
    .where(eq(places.userId, userId));
  return rows[0]?.value ?? 0;
}

async function countMediaRows(userId: string): Promise<number> {
  const database = getDb();
  const rows = await database
    .select({ value: count() })
    .from(media)
    .where(eq(media.userId, userId));
  return rows[0]?.value ?? 0;
}

/** Enforces the plan's max pinned-places limit. Call before inserting a new place. */
export async function assertPlaceLimit(userId: string): Promise<void> {
  const plan = await getEffectivePlan(userId);
  const limits = PLAN_LIMITS[plan];
  await assertCountLimit({
    max: limits.maxPlaces,
    resourceLabel: "places",
    planName: planDisplayName(plan),
    currentCount: () => countPlaceRows(userId),
  });
}

/**
 * Enforces the plan's max active-trips limit. "Active" means any trip not
 * marked "past" (i.e. ongoing or upcoming) — the pricing table's "Active
 * trips" row isn't otherwise defined, so this is the plain-English reading.
 * Call only when the trip being created is itself not "past".
 */
export async function assertActiveTripLimit(userId: string): Promise<void> {
  const plan = await getEffectivePlan(userId);
  const limits = PLAN_LIMITS[plan];
  await assertCountLimit({
    max: limits.maxActiveTrips,
    resourceLabel: "active trips",
    planName: planDisplayName(plan),
    currentCount: async () => {
      const database = getDb();
      const rows = await database
        .select({ value: count() })
        .from(trips)
        .where(
          and(eq(trips.userId, userId), ne(trips.status, TRIP_STATUS.PAST)),
        );
      return rows[0]?.value ?? 0;
    },
  });
}

/** Enforces the plan's max photo-storage limit. Call before storing a new media blob. */
export async function assertPhotoLimit(userId: string): Promise<void> {
  const plan = await getEffectivePlan(userId);
  const limits = PLAN_LIMITS[plan];
  await assertCountLimit({
    max: limits.maxPhotos,
    resourceLabel: "photos",
    planName: planDisplayName(plan),
    currentCount: () => countMediaRows(userId),
  });
}

/** Enforces the plan's Instagram-sync feature flag. Call before starting OAuth or importing. */
export async function assertInstagramSyncAllowed(
  userId: string,
): Promise<void> {
  const plan = await getEffectivePlan(userId);
  assertFeatureAllowed(
    PLAN_LIMITS[plan].instagramSyncAllowed,
    planDisplayName(plan),
    "Instagram sync",
  );
}

/** Enforces which map styles the plan may select. Call before saving a defaultMapStyle preference. */
export async function assertMapStyleAllowed(
  userId: string,
  style: MapStyle,
): Promise<void> {
  const plan = await getEffectivePlan(userId);
  const limits = PLAN_LIMITS[plan];
  if (!limits.mapStyles.includes(style)) {
    throw createError({
      statusCode: 402,
      statusMessage: `The "${style}" map style is not available on the ${planDisplayName(plan)} plan. Upgrade to unlock all map styles.`,
    });
  }
}

/**
 * Enforces the plan's public-traveler-profile feature flag. Call before saving
 * a publicProfile preference. Turning the flag off is always allowed regardless
 * of plan.
 */
export async function assertPublicProfileAllowed(
  userId: string,
  requestedPublicProfile: boolean,
): Promise<void> {
  if (!requestedPublicProfile) {
    return;
  }
  const plan = await getEffectivePlan(userId);
  assertFeatureAllowed(
    PLAN_LIMITS[plan].publicProfileAllowed,
    planDisplayName(plan),
    "Public traveler profile",
  );
}

/**
 * Clears the stored `publicProfile` preference when a billing change has
 * *terminally* dropped the user off a plan that includes the public traveler
 * profile (only Nomad does). Call after any change to billing state (see the
 * Stripe webhook handler).
 *
 * assertPublicProfileAllowed only guards the write path (the preferences PATCH),
 * so a plan change made outside that path — a downgrade to Wanderer, or a
 * cancellation that drops the user to Drifter — would otherwise leave the flag
 * set. The public read paths (profile, followers, discover, search) gate purely
 * on that stored boolean, never on the effective plan, so a stale `true` keeps a
 * downgraded user publicly discoverable and their public guides open. Clearing
 * it here closes every read path at once.
 *
 * Deliberately leaves `past_due` alone: that is a recoverable dunning state, and
 * clearing the flag is irreversible (a later successful retry would restore
 * every other paid feature but not this destroyed opt-in). Enforcement still
 * hides paid features during dunning via getEffectivePlan; the irreversible
 * preference write waits for the cancellation that unpaid dunning ultimately
 * produces. No-op when the plan still allows it, so an upgrade or renewal never
 * clears a valid opt-in.
 */
export async function revokePublicProfileIfPlanDisallows(
  userId: string,
): Promise<void> {
  const subscription = await getSubscriptionForUser(userId);
  if (subscription.status === SUBSCRIPTION_STATUS.PAST_DUE) {
    return;
  }
  const entitledPlan =
    subscription.status === SUBSCRIPTION_STATUS.ACTIVE
      ? subscription.plan
      : PLAN.DRIFTER;
  if (PLAN_LIMITS[entitledPlan].publicProfileAllowed) {
    return;
  }
  const database = getDb();
  // Only touch rows that actually carry the flag. Stripe fires
  // subscription.updated on renewals, card updates, and proration, so an
  // unconditional write would dirty most users' preference rows on every such
  // event just to set false → false.
  await database
    .update(userPreferences)
    .set({ publicProfile: false })
    .where(
      and(
        eq(userPreferences.userId, userId),
        eq(userPreferences.publicProfile, true),
      ),
    );
}
