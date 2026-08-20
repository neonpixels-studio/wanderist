import type Stripe from "stripe";
import {
  constructStripeEvent,
  requireStripeWebhookSecret,
} from "../../utils/stripe";
import {
  upsertSubscriptionFromStripeSubscription,
  markSubscriptionCanceled,
  getUserIdFromSubscription,
} from "../../utils/subscriptions";
import {
  revokePublicProfileOnCancellation,
  revokePublicProfileOnDowngrade,
} from "../../utils/planLimits";

const STRIPE_SIGNATURE_HEADER = "stripe-signature";
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Runs a subscription sync (upsert or cancel) then reconciles the user's
 * public-profile entitlement — a downgrade or cancellation must revoke public
 * discoverability, which the sync itself does not touch (see
 * revokePublicProfileOnDowngrade / revokePublicProfileOnCancellation). The
 * reconcile re-reads the row the sync just wrote, so it must run after it. Skips
 * reconciliation when the event carries no userId, exactly as the sync
 * functions themselves no-op.
 *
 * `eventCreatedAt` is the Stripe event's `created` time, threaded into the sync
 * so an out-of-order redelivery of an older event is rejected as stale (see
 * server/utils/subscriptions.ts).
 */
async function applySubscriptionSync(
  subscription: Stripe.Subscription,
  eventCreatedAt: Date,
  sync: (
    subscription: Stripe.Subscription,
    eventCreatedAt: Date,
  ) => Promise<void>,
  reconcilePublicProfile: (userId: string) => Promise<void>,
): Promise<void> {
  await sync(subscription, eventCreatedAt);
  const userId = getUserIdFromSubscription(subscription);
  if (!userId) {
    return;
  }
  try {
    await reconcilePublicProfile(userId);
  } catch (error) {
    // Rethrow so Stripe retries (both syncs are idempotent on replay), but log
    // first: a swallowed failure here would silently leave a downgraded user
    // publicly discoverable once Stripe exhausts its retries.
    console.error(
      `Stripe webhook: public-profile reconcile failed for user ${userId}`,
      error,
    );
    throw error;
  }
}

const EVENT_SUBSCRIPTION_CREATED = "customer.subscription.created";
const EVENT_SUBSCRIPTION_UPDATED = "customer.subscription.updated";
const EVENT_SUBSCRIPTION_DELETED = "customer.subscription.deleted";
// Stripe recommends syncing subscription state from customer.subscription.*
// events, not checkout.session.completed — the session doesn't carry the
// full Subscription fields (status, items, trial, period) this app needs,
// and customer.subscription.created fires around the same time carrying all
// of them. This event is still explicitly acknowledged (not left to fall
// through to the generic "unknown event" branch) so it's clear in the event
// list below that it was considered, not missed.
const EVENT_CHECKOUT_SESSION_COMPLETED = "checkout.session.completed";

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event);
  if (!rawBody) {
    throw createError({ statusCode: 400, statusMessage: "Empty request body" });
  }

  const signature = getHeader(event, STRIPE_SIGNATURE_HEADER);
  if (!signature) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing Stripe-Signature header",
    });
  }

  const secret = requireStripeWebhookSecret();

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = constructStripeEvent(rawBody, signature, secret);
  } catch (error) {
    console.error("Stripe webhook: signature verification failed", error);
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid webhook signature",
    });
  }

  // Stripe's `event.created` is a Unix timestamp in seconds.
  const eventCreatedAt = new Date(
    stripeEvent.created * MILLISECONDS_PER_SECOND,
  );

  if (
    stripeEvent.type === EVENT_SUBSCRIPTION_CREATED ||
    stripeEvent.type === EVENT_SUBSCRIPTION_UPDATED
  ) {
    await applySubscriptionSync(
      stripeEvent.data.object as Stripe.Subscription,
      eventCreatedAt,
      upsertSubscriptionFromStripeSubscription,
      revokePublicProfileOnDowngrade,
    );
    return { ok: true };
  }

  if (stripeEvent.type === EVENT_SUBSCRIPTION_DELETED) {
    await applySubscriptionSync(
      stripeEvent.data.object as Stripe.Subscription,
      eventCreatedAt,
      markSubscriptionCanceled,
      revokePublicProfileOnCancellation,
    );
    return { ok: true };
  }

  if (stripeEvent.type === EVENT_CHECKOUT_SESSION_COMPLETED) {
    return { ok: true };
  }

  // Unknown event types are acknowledged without error so Stripe does not retry.
  return { ok: true };
});
