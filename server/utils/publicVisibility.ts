/**
 * Effective public-profile entitlement, shared by every public read path
 * (profile, followers, discover, search, single-guide).
 *
 * The stored `userPreferences.publicProfile` boolean is only an opt-in: it can
 * linger `true` after a subscription lapses (Stripe leaves a failed payer at
 * `past_due`/`paused` rather than auto-cancelling, and
 * revokePublicProfileOnDowngrade deliberately acts only on the ACTIVE state).
 * A read path that gates on the boolean alone therefore keeps a lapsed/paused
 * subscriber publicly discoverable. These helpers close that leak by also
 * requiring the owner's *effective* plan to still include the public traveler
 * profile.
 *
 * Two twins, one rule: `subscriptionEntitlesPublicProfile` (JS, used by the
 * profile read path which decides in-process) and
 * `entitledToPublicProfileCondition` (SQL, composed into the collection read
 * paths). Both read `PUBLIC_PROFILE_PLANS`, so which tiers count as public is
 * defined once and cannot drift between them.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  subscriptions,
  userPreferences,
  SUBSCRIPTION_STATUS,
} from "../db/schema";
import { PLAN_LIMITS } from "./planLimits";
import type { Plan, SubscriptionStatus } from "./subscriptions";

/**
 * The plan tiers whose limits include the public traveler profile, derived
 * straight from PLAN_LIMITS so this read-path gate and the write-path guard
 * (assertPublicProfileAllowed) can never disagree about which tiers are public.
 */
export const PUBLIC_PROFILE_PLANS: Plan[] = (
  Object.keys(PLAN_LIMITS) as Plan[]
).filter((plan) => PLAN_LIMITS[plan].publicProfileAllowed);

/**
 * Whether a user is *effectively* entitled to a public traveler profile right
 * now: an ACTIVE subscription (Stripe `active`/`trialing`, per
 * mapStripeSubscriptionStatus) on a tier in PUBLIC_PROFILE_PLANS. A
 * `past_due`/`paused`/`canceled` subscription — or no subscription at all
 * (free Drifter) — is not entitled, even while a stored `plan` still reads a
 * paid tier. The in-process twin of entitledToPublicProfileCondition.
 */
export function subscriptionEntitlesPublicProfile(subscription: {
  plan: Plan | null;
  status: SubscriptionStatus | null;
}): boolean {
  if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    return false;
  }
  if (!subscription.plan) {
    return false;
  }
  return PUBLIC_PROFILE_PLANS.includes(subscription.plan);
}

/**
 * SQL predicate: the profile owner (the joined `user_preferences` row) is
 * currently entitled to a public traveler profile. A correlated EXISTS on
 * `subscriptions` keyed by `userPreferences.userId` so it composes into any
 * public read path via `and()` regardless of which table `userPreferences` was
 * joined from, and never fans out rows (subscriptions is 1:1 with users). Free
 * Drifter users have no subscriptions row and are correctly excluded. The SQL
 * twin of subscriptionEntitlesPublicProfile.
 */
export function entitledToPublicProfileCondition() {
  return sql`exists (select 1 from ${subscriptions} where ${and(
    eq(subscriptions.userId, userPreferences.userId),
    eq(subscriptions.status, SUBSCRIPTION_STATUS.ACTIVE),
    inArray(subscriptions.plan, PUBLIC_PROFILE_PLANS),
  )})`;
}
