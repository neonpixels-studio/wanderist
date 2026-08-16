/**
 * Unit tests for server/utils/publicVisibility.ts — the effective public-profile
 * entitlement rule shared by every public read path.
 *
 * These assert the leak the feature closes: an opted-in user whose subscription
 * is stuck at past_due/paused (Stripe not auto-cancelling) is NOT effectively
 * public, while active/trialing subscribers on the public tier are.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { PLAN, SUBSCRIPTION_STATUS } from "../../server/db/schema";
import { mapStripeSubscriptionStatus } from "../../server/utils/subscriptions";
import type { Stripe } from "stripe";
import {
  PUBLIC_PROFILE_PLANS,
  subscriptionEntitlesPublicProfile,
  entitledToPublicProfileCondition,
} from "../../server/utils/publicVisibility";

describe("PUBLIC_PROFILE_PLANS", () => {
  it("is exactly the tiers whose limits include the public traveler profile", () => {
    // Nomad is the only tier that advertises the public profile; deriving the
    // set from PLAN_LIMITS keeps this gate aligned with the write-path guard.
    // Asserted as an exact list so promoting another tier to public forces a
    // deliberate edit here.
    expect(PUBLIC_PROFILE_PLANS).toEqual([PLAN.NOMAD]);
  });
});

describe("entitledToPublicProfileCondition (rendered SQL)", () => {
  // The other read-path tests compare this predicate against itself, so they
  // only catch it being *removed* — not being wrong. Render the real SQL so a
  // broken correlation (wrong column) or a loosened status/plan filter fails
  // here, where the leak would actually reopen.
  const rendered = new PgDialect().sqlToQuery(
    entitledToPublicProfileCondition(),
  );

  it("correlates the subscription to the profile owner", () => {
    expect(rendered.sql).toContain('"subscriptions"."user_id"');
    expect(rendered.sql).toContain('"user_preferences"."user_id"');
  });

  it("requires an active subscription on a public tier", () => {
    expect(rendered.sql).toContain('"subscriptions"."status"');
    expect(rendered.sql).toContain('"subscriptions"."plan"');
    // Bound params asserted as literals (not derived from the same constant),
    // so widening the public-tier set to include another plan forces a
    // deliberate edit here rather than silently staying green.
    expect(rendered.params).toEqual([SUBSCRIPTION_STATUS.ACTIVE, PLAN.NOMAD]);
  });
});

describe("subscriptionEntitlesPublicProfile", () => {
  it("entitles an active subscriber on the public tier", () => {
    expect(
      subscriptionEntitlesPublicProfile({
        plan: PLAN.NOMAD,
        status: SUBSCRIPTION_STATUS.ACTIVE,
      }),
    ).toBe(true);
  });

  it("does NOT entitle a past_due subscriber even on the public tier", () => {
    expect(
      subscriptionEntitlesPublicProfile({
        plan: PLAN.NOMAD,
        status: SUBSCRIPTION_STATUS.PAST_DUE,
      }),
    ).toBe(false);
  });

  it("does NOT entitle a canceled subscriber (paused collapses here)", () => {
    expect(
      subscriptionEntitlesPublicProfile({
        plan: PLAN.NOMAD,
        status: SUBSCRIPTION_STATUS.CANCELED,
      }),
    ).toBe(false);
  });

  it("does NOT entitle an active subscriber on a non-public tier", () => {
    expect(
      subscriptionEntitlesPublicProfile({
        plan: PLAN.WANDERER,
        status: SUBSCRIPTION_STATUS.ACTIVE,
      }),
    ).toBe(false);
  });

  it("does NOT entitle a free user with no subscription row", () => {
    expect(
      subscriptionEntitlesPublicProfile({ plan: null, status: null }),
    ).toBe(false);
  });
});

describe("effective entitlement via Stripe status mapping", () => {
  // Prove the acceptance criteria end to end: a raw Stripe status maps to the
  // stored enum, then the entitlement rule decides discoverability. paused and
  // past_due must be non-discoverable; active and trialing must be.
  const cases: Array<{
    stripe: Stripe.Subscription.Status;
    expected: boolean;
  }> = [
    { stripe: "active", expected: true },
    { stripe: "trialing", expected: true },
    { stripe: "past_due", expected: false },
    { stripe: "paused", expected: false },
    { stripe: "canceled", expected: false },
    { stripe: "unpaid", expected: false },
    { stripe: "incomplete", expected: false },
  ];

  it.each(cases)(
    "Stripe '$stripe' → discoverable=$expected on the Nomad tier",
    ({ stripe, expected }) => {
      const status = mapStripeSubscriptionStatus(stripe);
      expect(
        subscriptionEntitlesPublicProfile({ plan: PLAN.NOMAD, status }),
      ).toBe(expected);
    },
  );
});
