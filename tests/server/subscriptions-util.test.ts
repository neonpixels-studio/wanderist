/**
 * Unit tests for server/utils/subscriptions.ts — the DB-side isolation
 * boundary for billing state, synced from Stripe webhook events.
 *
 * The database and the Stripe Price-ID mapping (server/utils/stripe.ts) are
 * mocked so no network or database access is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelectLimit,
  mockSelectWhere,
  mockSelectFrom,
  mockSelect,
  mockInsertOnConflictDoUpdate,
  mockInsertValues,
  mockInsert,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
  mockGetDb,
  mockMapPriceIdToPlan,
} = vi.hoisted(() => {
  const mockSelectLimit = vi.fn().mockResolvedValue([]);
  const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

  const mockInsertOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const mockInsertValues = vi.fn(() => ({
    onConflictDoUpdate: mockInsertOnConflictDoUpdate,
  }));
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  const mockGetDb = vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }));

  return {
    mockSelectLimit,
    mockSelectWhere,
    mockSelectFrom,
    mockSelect,
    mockInsertOnConflictDoUpdate,
    mockInsertValues,
    mockInsert,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    mockGetDb,
    mockMapPriceIdToPlan: vi.fn(),
  };
});

vi.mock("../../server/db/index", () => ({
  getDb: mockGetDb,
}));

vi.mock("../../server/utils/stripe", () => ({
  mapPriceIdToPlan: mockMapPriceIdToPlan,
}));

const {
  mapStripeSubscriptionStatus,
  entitledPlan,
  getUserIdFromSubscription,
  getSubscriptionForUser,
  getEffectivePlan,
  getStripeCustomerIdForUser,
  upsertSubscriptionFromStripeSubscription,
  markSubscriptionCanceled,
} = await import("../../server/utils/subscriptions");

function buildSubscriptionRow(
  status: string,
  plan: string,
): Parameters<typeof entitledPlan>[0] {
  return {
    plan,
    status,
    billingCycle: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  } as Parameters<typeof entitledPlan>[0];
}

function resetDbMocks() {
  mockSelectLimit.mockResolvedValue([]);
  mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
  mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
  mockSelect.mockReturnValue({ from: mockSelectFrom });

  mockInsertOnConflictDoUpdate.mockResolvedValue(undefined);
  mockInsertValues.mockReturnValue({
    onConflictDoUpdate: mockInsertOnConflictDoUpdate,
  });
  mockInsert.mockReturnValue({ values: mockInsertValues });

  mockUpdateWhere.mockResolvedValue(undefined);
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMocks();
  mockMapPriceIdToPlan.mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// mapStripeSubscriptionStatus
// ---------------------------------------------------------------------------

describe("mapStripeSubscriptionStatus", () => {
  it("maps 'active' and 'trialing' to 'active'", () => {
    expect(mapStripeSubscriptionStatus("active")).toBe("active");
    expect(mapStripeSubscriptionStatus("trialing")).toBe("active");
  });

  it("maps 'past_due' to 'past_due'", () => {
    expect(mapStripeSubscriptionStatus("past_due")).toBe("past_due");
  });

  it("collapses every other status to 'canceled'", () => {
    for (const status of [
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
    ] as const) {
      expect(mapStripeSubscriptionStatus(status)).toBe("canceled");
    }
  });
});

// ---------------------------------------------------------------------------
// entitledPlan
// ---------------------------------------------------------------------------

describe("entitledPlan", () => {
  it("returns the row's plan while active", () => {
    expect(entitledPlan(buildSubscriptionRow("active", "nomad"))).toBe("nomad");
  });

  it("collapses past_due and canceled to the free Drifter plan (no grace period)", () => {
    expect(entitledPlan(buildSubscriptionRow("past_due", "nomad"))).toBe(
      "drifter",
    );
    expect(entitledPlan(buildSubscriptionRow("canceled", "nomad"))).toBe(
      "drifter",
    );
  });
});

// ---------------------------------------------------------------------------
// getUserIdFromSubscription
// ---------------------------------------------------------------------------

describe("getUserIdFromSubscription", () => {
  it("returns the metadata userId when present", () => {
    expect(
      getUserIdFromSubscription({ metadata: { userId: "user-9" } } as never),
    ).toBe("user-9");
  });

  it("returns null when metadata carries no userId", () => {
    expect(getUserIdFromSubscription({ metadata: {} } as never)).toBeNull();
    expect(getUserIdFromSubscription({} as never)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSubscriptionForUser / getEffectivePlan
// ---------------------------------------------------------------------------

describe("getSubscriptionForUser", () => {
  it("returns the free Drifter plan when no row exists", async () => {
    mockSelectLimit.mockResolvedValue([]);

    const result = await getSubscriptionForUser("user-1");

    expect(result).toEqual({
      plan: "drifter",
      status: "active",
      billingCycle: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  });

  it("returns a fresh object per call for the free plan (not a shared mutable singleton)", async () => {
    mockSelectLimit.mockResolvedValue([]);

    const first = await getSubscriptionForUser("user-1");
    const second = await getSubscriptionForUser("user-2");

    expect(first).not.toBe(second);
    first.plan = "nomad";
    expect(second.plan).toBe("drifter");
  });

  it("returns the row's plan when status is active", async () => {
    const periodEnd = new Date("2026-08-01T00:00:00.000Z");
    mockSelectLimit.mockResolvedValue([
      {
        plan: "nomad",
        status: "active",
        billingCycle: "yearly",
        trialEndsAt: null,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
    ]);

    const result = await getSubscriptionForUser("user-1");

    expect(result).toEqual({
      plan: "nomad",
      status: "active",
      billingCycle: "yearly",
      trialEndsAt: null,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });
  });

  it("still reports the real plan when status is past_due (for billing-management display)", async () => {
    const periodEnd = new Date("2026-08-01T00:00:00.000Z");
    mockSelectLimit.mockResolvedValue([
      {
        plan: "wanderer",
        status: "past_due",
        billingCycle: "monthly",
        trialEndsAt: null,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
    ]);

    const result = await getSubscriptionForUser("user-1");

    expect(result.plan).toBe("wanderer");
    expect(result.status).toBe("past_due");
    expect(result.currentPeriodEnd).toBe(periodEnd);
  });

  it("still reports the real plan when status is canceled", async () => {
    mockSelectLimit.mockResolvedValue([
      {
        plan: "wanderer",
        status: "canceled",
        billingCycle: "monthly",
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    ]);

    const result = await getSubscriptionForUser("user-1");

    expect(result.plan).toBe("wanderer");
  });

  it("reports cancelAtPeriodEnd true for a still-active subscription scheduled to cancel", async () => {
    mockSelectLimit.mockResolvedValue([
      {
        plan: "nomad",
        status: "active",
        billingCycle: "monthly",
        trialEndsAt: null,
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        cancelAtPeriodEnd: true,
      },
    ]);

    const result = await getSubscriptionForUser("user-1");

    expect(result.status).toBe("active");
    expect(result.cancelAtPeriodEnd).toBe(true);
  });
});

describe("getEffectivePlan", () => {
  it("returns the plan tier for an active subscription", async () => {
    mockSelectLimit.mockResolvedValue([
      {
        plan: "nomad",
        status: "active",
        billingCycle: "yearly",
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    ]);

    expect(await getEffectivePlan("user-1")).toBe("nomad");
  });

  it("collapses to the free Drifter plan when status is past_due", async () => {
    mockSelectLimit.mockResolvedValue([
      {
        plan: "wanderer",
        status: "past_due",
        billingCycle: "monthly",
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    ]);

    expect(await getEffectivePlan("user-1")).toBe("drifter");
  });

  it("collapses to the free Drifter plan when status is canceled", async () => {
    mockSelectLimit.mockResolvedValue([
      {
        plan: "nomad",
        status: "canceled",
        billingCycle: "yearly",
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    ]);

    expect(await getEffectivePlan("user-1")).toBe("drifter");
  });

  it("returns the free Drifter plan when no row exists", async () => {
    mockSelectLimit.mockResolvedValue([]);
    expect(await getEffectivePlan("user-1")).toBe("drifter");
  });
});

// ---------------------------------------------------------------------------
// getStripeCustomerIdForUser
// ---------------------------------------------------------------------------

describe("getStripeCustomerIdForUser", () => {
  it("returns the stored customer ID when a row exists", async () => {
    mockSelectLimit.mockResolvedValue([{ stripeCustomerId: "cus_123" }]);
    expect(await getStripeCustomerIdForUser("user-1")).toBe("cus_123");
  });

  it("returns null when no row exists", async () => {
    mockSelectLimit.mockResolvedValue([]);
    expect(await getStripeCustomerIdForUser("user-1")).toBeNull();
  });

  it("returns null when the row exists but has no customer ID recorded", async () => {
    mockSelectLimit.mockResolvedValue([{ stripeCustomerId: null }]);
    expect(await getStripeCustomerIdForUser("user-1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// upsertSubscriptionFromStripeSubscription
// ---------------------------------------------------------------------------

describe("upsertSubscriptionFromStripeSubscription", () => {
  function buildSubscription(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      metadata: { userId: "user-1" },
      items: {
        data: [
          {
            price: { id: "price_wanderer_monthly" },
            current_period_end: 1785000000,
          },
        ],
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    mockMapPriceIdToPlan.mockReturnValue({
      plan: "wanderer",
      cycle: "monthly",
    });
  });

  it("upserts the subscriptions row from a valid subscription", async () => {
    await upsertSubscriptionFromStripeSubscription(
      buildSubscription() as never,
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        plan: "wanderer",
        status: "active",
        billingCycle: "monthly",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(1785000000 * 1000),
        trialEndsAt: null,
      }),
    );
    expect(mockInsertOnConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("resolves customer from an expanded customer object", async () => {
    await upsertSubscriptionFromStripeSubscription(
      buildSubscription({ customer: { id: "cus_expanded" } }) as never,
    );

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: "cus_expanded" }),
    );
  });

  it("maps trialing status to active and populates trialEndsAt from trial_end", async () => {
    await upsertSubscriptionFromStripeSubscription(
      buildSubscription({ status: "trialing", trial_end: 1785100000 }) as never,
    );

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        trialEndsAt: new Date(1785100000 * 1000),
      }),
    );
  });

  it("stores cancelAtPeriodEnd true when the subscription is scheduled to cancel", async () => {
    await upsertSubscriptionFromStripeSubscription(
      buildSubscription({ cancel_at_period_end: true }) as never,
    );

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAtPeriodEnd: true }),
    );
  });

  it("no-ops when metadata.userId is missing", async () => {
    await upsertSubscriptionFromStripeSubscription(
      buildSubscription({ metadata: {} }) as never,
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("no-ops when there are no subscription items", async () => {
    await upsertSubscriptionFromStripeSubscription(
      buildSubscription({ items: { data: [] } }) as never,
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("no-ops when the price doesn't map to a known plan/cycle", async () => {
    mockMapPriceIdToPlan.mockReturnValue(null);

    await upsertSubscriptionFromStripeSubscription(
      buildSubscription() as never,
    );

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("stores a null currentPeriodEnd when the item has none", async () => {
    await upsertSubscriptionFromStripeSubscription(
      buildSubscription({
        items: {
          data: [
            {
              price: { id: "price_wanderer_monthly" },
              current_period_end: null,
            },
          ],
        },
      }) as never,
    );

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ currentPeriodEnd: null }),
    );
  });

  it("skips a stale event for a subscription that's since been superseded", async () => {
    // The row already tracks a different (newer) subscription id — an
    // out-of-order event for the old, superseded subscription must not
    // resurrect its plan and re-grant entitlements.
    mockSelectLimit.mockResolvedValue([{ stripeSubscriptionId: "sub_newer" }]);

    await upsertSubscriptionFromStripeSubscription(
      buildSubscription({ id: "sub_123" }) as never,
    );

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("proceeds when the existing row has no subscription id recorded yet (e.g. after a prior cancellation cleared it)", async () => {
    mockSelectLimit.mockResolvedValue([{ stripeSubscriptionId: null }]);

    await upsertSubscriptionFromStripeSubscription(
      buildSubscription() as never,
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("proceeds when the existing row tracks the same subscription id", async () => {
    mockSelectLimit.mockResolvedValue([{ stripeSubscriptionId: "sub_123" }]);

    await upsertSubscriptionFromStripeSubscription(
      buildSubscription({ id: "sub_123" }) as never,
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// markSubscriptionCanceled
// ---------------------------------------------------------------------------

describe("markSubscriptionCanceled", () => {
  function buildSubscription(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub_123",
      customer: "cus_123",
      status: "canceled",
      cancel_at_period_end: false,
      trial_end: null,
      metadata: { userId: "user-1" },
      items: { data: [] },
      ...overrides,
    };
  }

  it("marks the row canceled, clears stripeSubscriptionId, but keeps stripeCustomerId", async () => {
    mockSelectLimit.mockResolvedValue([{ stripeSubscriptionId: "sub_123" }]);

    await markSubscriptionCanceled(buildSubscription() as never);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      status: "canceled",
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: null,
    });
  });

  it("no-ops (and warns) when the deletion arrives before any row exists", async () => {
    mockSelectLimit.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await markSubscriptionCanceled(buildSubscription() as never);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("marks the row canceled when the existing row has no subscription id recorded", async () => {
    mockSelectLimit.mockResolvedValue([{ stripeSubscriptionId: null }]);

    await markSubscriptionCanceled(buildSubscription() as never);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips a stale event for a subscription that's since been replaced", async () => {
    mockSelectLimit.mockResolvedValue([{ stripeSubscriptionId: "sub_newer" }]);

    await markSubscriptionCanceled(
      buildSubscription({ id: "sub_123" }) as never,
    );

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("no-ops when metadata.userId is missing", async () => {
    await markSubscriptionCanceled(
      buildSubscription({ metadata: {} }) as never,
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
