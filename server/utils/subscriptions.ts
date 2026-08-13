import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import {
  subscriptions,
  PLAN,
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
} from "../db/schema";
import { mapPriceIdToPlan } from "./stripe";

export type Plan = (typeof PLAN)[keyof typeof PLAN];
export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];
export type BillingCycle = (typeof BILLING_CYCLE)[keyof typeof BILLING_CYCLE];

export interface UserSubscription {
  plan: Plan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const FREE_SUBSCRIPTION: UserSubscription = {
  plan: PLAN.DRIFTER,
  status: SUBSCRIPTION_STATUS.ACTIVE,
  billingCycle: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

/**
 * Collapses Stripe's wider subscription status vocabulary ('trialing' |
 * 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' |
 * 'incomplete_expired' | 'paused') onto this app's three-value enum.
 * `trialing` counts as ACTIVE — a trialing subscription is already fully
 * entitled (see getEffectivePlan). Every other non-`active`/`past_due` status
 * collapses to CANCELED: `incomplete`/`incomplete_expired` mean the first
 * payment never went through (no entitlement was ever earned), and `unpaid`/
 * `paused` mean payment has definitively failed past Stripe's retry schedule.
 * Treating all of those as "no entitlement" is the safer default for a
 * paywall — the alternative (treating incomplete as active) risks granting
 * a paid tier to someone who never successfully paid.
 */
export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): SubscriptionStatus {
  if (status === "active" || status === "trialing") {
    return SUBSCRIPTION_STATUS.ACTIVE;
  }
  if (status === "past_due") {
    return SUBSCRIPTION_STATUS.PAST_DUE;
  }
  return SUBSCRIPTION_STATUS.CANCELED;
}

/**
 * Returns the authenticated user's real subscription state, defaulting to the
 * free Drifter plan when no row exists at all.
 *
 * This reflects the row as Stripe reported it — including `plan` for a
 * `past_due` subscription — so callers like Settings can still show billing-
 * management UI (e.g. "update your card") for a customer whose payment is
 * failing. Use `getEffectivePlan` instead when the question is "what plan is
 * this user entitled to use right now" (enforcement), not "what does their
 * billing record say."
 */
export async function getSubscriptionForUser(
  userId: string,
): Promise<UserSubscription> {
  const database = getDb();
  const rows = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    // Spread a fresh copy rather than returning the shared FREE_SUBSCRIPTION
    // object by reference — every free user would otherwise get the exact
    // same instance, and a future mutation by one caller would silently leak
    // into every other caller's "default". Mirrors the same defensive copy
    // in app/composables/useBilling.ts's FREE_SUBSCRIPTION_DEFAULT.
    return { ...FREE_SUBSCRIPTION };
  }

  return {
    plan: row.plan,
    status: row.status,
    billingCycle: row.billingCycle,
    trialEndsAt: row.trialEndsAt,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

/**
 * The plan tier a subscription entitles its user to right now: the row's plan
 * while ACTIVE, otherwise the free Drifter plan. A `past_due` or `canceled` row
 * has no live entitlement even though `getSubscriptionForUser` (used for
 * display) still reports the real plan. Treating past_due the same as canceled
 * (no grace period) is a product decision — see the PR description for the human
 * to confirm before launch. Kept as one pure helper so every "what is this user
 * entitled to" decision reads from a single rule and can't drift.
 */
export function entitledPlan(subscription: UserSubscription): Plan {
  if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    return PLAN.DRIFTER;
  }
  return subscription.plan;
}

/**
 * Returns the plan tier `userId` is entitled to use right now, for plan-limit
 * enforcement — the DB-backed form of `entitledPlan`.
 */
export async function getEffectivePlan(userId: string): Promise<Plan> {
  return entitledPlan(await getSubscriptionForUser(userId));
}

/**
 * Returns the Stripe customer ID recorded for `userId`, or null if no row
 * exists yet or none was ever recorded. Used by the billing-portal route
 * (which requires a customer ID) and by checkout-session creation (to reuse
 * an existing customer instead of creating a duplicate one).
 */
export async function getStripeCustomerIdForUser(
  userId: string,
): Promise<string | null> {
  const database = getDb();
  const rows = await database
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return rows[0]?.stripeCustomerId ?? null;
}

/**
 * The sync key (`metadata.userId`, set by createCheckoutSession) an event is
 * attributable to, or null when it carries none. Single source for the
 * extraction so the webhook handler and both sync functions stay in step if
 * attribution ever changes (e.g. a fallback customer-ID lookup).
 */
export function getUserIdFromSubscription(
  subscription: Stripe.Subscription,
): string | null {
  return subscription.metadata?.userId ?? null;
}

type SubscriptionIdRow = {
  stripeSubscriptionId: string | null;
};

async function getSubscriptionIdRow(
  database: ReturnType<typeof getDb>,
  userId: string,
): Promise<SubscriptionIdRow | undefined> {
  const rows = await database
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return rows[0];
}

/**
 * True when a row already exists recording a *different* Stripe subscription
 * ID than the one this webhook event is about — i.e. this event is stale/
 * out-of-order relative to a newer subscription already recorded (e.g. the
 * user canceled and resubscribed, and a delayed event for the old, superseded
 * subscription arrives after the new one was already synced). No existing
 * row, or a row with no ID recorded yet, is never considered stale.
 */
function isStaleEvent(
  recordedId: string | null | undefined,
  incomingId: string,
): boolean {
  if (!recordedId) {
    return false;
  }
  return recordedId !== incomingId;
}

/**
 * Upserts the local `subscriptions` row from a `customer.subscription.created`
 * / `customer.subscription.updated` webhook event.
 *
 * Requires `subscription.metadata.userId`, set by createCheckoutSession (see
 * server/utils/stripe.ts) via `subscription_data.metadata` at checkout time —
 * this is the sync key, so no separate Stripe-customer-ID lookup is needed to
 * attribute the event back to a user. No-ops (rather than throwing) when it's
 * missing or the subscription's price doesn't map to a known plan, so an
 * unrecognized payload doesn't fail webhook delivery — Stripe retries on
 * non-2xx, and there is nothing actionable to retry here.
 *
 * Known, accepted race (mirrors the exact tradeoff the previous Clerk Billing
 * integration accepted for the same reason): markSubscriptionCanceled clears
 * stripeSubscriptionId on cancellation so a genuine resubscribe isn't
 * rejected as stale (see its docstring). That means a `subscription.updated`
 * for the just-canceled subscription, delivered *after* its `.deleted` event
 * (Stripe does not guarantee delivery order), would no longer be recognized
 * as stale here and could briefly re-activate the row with a future
 * `current_period_end`. Closing this fully would require tracking the
 * canceled subscription's ID separately from the live one (an extra column)
 * purely to guard a narrow, transient race — not done here; the same
 * cost/benefit call the original Clerk integration made for its equivalent
 * out-of-order risk.
 */
export async function upsertSubscriptionFromStripeSubscription(
  subscription: Stripe.Subscription,
): Promise<void> {
  const userId = getUserIdFromSubscription(subscription);
  if (!userId) {
    return;
  }

  const item = subscription.items.data[0];
  const mapped = mapPriceIdToPlan(item?.price?.id);
  if (!item || !mapped) {
    // No item, or a Price ID this app doesn't map to a known tier/cycle
    // combination. Nothing to sync.
    return;
  }

  const database = getDb();
  const existing = await getSubscriptionIdRow(database, userId);
  if (isStaleEvent(existing?.stripeSubscriptionId, subscription.id)) {
    return;
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const values = {
    userId,
    plan: mapped.plan,
    status: mapStripeSubscriptionStatus(subscription.status),
    billingCycle: mapped.cycle,
    trialEndsAt: subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null,
    currentPeriodEnd: item.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
  };

  await database
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

/**
 * Marks the user's subscription row canceled from a
 * `customer.subscription.deleted` webhook event — Stripe fires this only once
 * a subscription has truly ended (either canceled immediately, or naturally
 * at the end of a period after the customer scheduled a cancel-at-period-end
 * via the Billing Portal), so no separate "is this really final" check is
 * needed the way the previous billing provider required.
 *
 * Only applies when the incoming subscription ID matches the row's recorded
 * stripeSubscriptionId (or the row has none recorded). Stripe does not
 * guarantee webhook delivery order, so an out-of-order "deleted" event for a
 * since-replaced subscription must not clobber a newer, already-active one —
 * the same risk already accepted for out-of-order user.updated events in
 * server/api/webhooks/clerk.post.ts.
 *
 * stripeCustomerId is deliberately NOT cleared: it's the enduring identity of
 * the billing customer (not per-subscription like stripeSubscriptionId), and
 * is still needed for the Billing Portal and to let a resubscribing user
 * reuse the same Stripe customer rather than creating a duplicate one.
 * stripeSubscriptionId IS cleared, for the same reason the previous provider
 * cleared its equivalent ID on cancellation: so a genuinely new
 * subscription.created for a resubscribing user (a fresh Stripe subscription
 * ID) isn't rejected as a stale/out-of-order event by
 * upsertSubscriptionFromStripeSubscription's isStaleEvent check, which treats
 * a row with no recorded ID as never stale.
 */
export async function markSubscriptionCanceled(
  subscription: Stripe.Subscription,
): Promise<void> {
  const userId = getUserIdFromSubscription(subscription);
  if (!userId) {
    return;
  }

  const database = getDb();
  const existing = await getSubscriptionIdRow(database, userId);
  if (isStaleEvent(existing?.stripeSubscriptionId, subscription.id)) {
    return;
  }

  if (!existing) {
    // The deletion arrived before subscription.created ever created a row
    // (Stripe delivery order isn't guaranteed). Nothing to mark canceled yet;
    // log so this isn't silently swallowed if a subsequent subscription.created
    // then incorrectly leaves the user "active".
    console.warn(
      `markSubscriptionCanceled: no subscriptions row yet for user ${userId}; deletion for subscription ${subscription.id} may have arrived before subscription.created`,
    );
    return;
  }

  await database
    .update(subscriptions)
    .set({
      status: SUBSCRIPTION_STATUS.CANCELED,
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: null,
    })
    .where(eq(subscriptions.userId, userId));
}
