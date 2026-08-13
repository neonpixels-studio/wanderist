/**
 * Tests for the Stripe webhook handler's signature verification and event
 * dispatch. The mapping/upsert logic itself is covered in depth by
 * tests/server/subscriptions-util.test.ts; here we only verify the handler
 * verifies the signature and routes each event type to the right function.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockConstructStripeEvent,
  mockRequireStripeWebhookSecret,
  mockUpsertSubscriptionFromStripeSubscription,
  mockMarkSubscriptionCanceled,
  mockRevokePublicProfileIfPlanDisallows,
  mockReadRawBody,
  mockGetHeader,
} = vi.hoisted(() => ({
  mockConstructStripeEvent: vi.fn(),
  mockRequireStripeWebhookSecret: vi.fn(() => "whsec_test"),
  mockUpsertSubscriptionFromStripeSubscription: vi
    .fn()
    .mockResolvedValue(undefined),
  mockMarkSubscriptionCanceled: vi.fn().mockResolvedValue(undefined),
  mockRevokePublicProfileIfPlanDisallows: vi.fn().mockResolvedValue(undefined),
  mockReadRawBody: vi.fn(),
  mockGetHeader: vi.fn(),
}));

vi.mock("../server/utils/stripe", () => ({
  constructStripeEvent: mockConstructStripeEvent,
  requireStripeWebhookSecret: mockRequireStripeWebhookSecret,
}));

vi.mock("../server/utils/subscriptions", () => ({
  upsertSubscriptionFromStripeSubscription:
    mockUpsertSubscriptionFromStripeSubscription,
  markSubscriptionCanceled: mockMarkSubscriptionCanceled,
}));

vi.mock("../server/utils/planLimits", () => ({
  revokePublicProfileIfPlanDisallows: mockRevokePublicProfileIfPlanDisallows,
}));

Object.assign(globalThis, {
  readRawBody: mockReadRawBody,
  getHeader: mockGetHeader,
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
  defineEventHandler: (handler: (event: object) => unknown) => handler,
});

const { default: stripeWebhookHandler } =
  await import("../server/api/webhooks/stripe.post");

function buildMockEvent(): object {
  return { path: "/api/webhooks/stripe", context: {} };
}

const SUBSCRIPTION_OBJECT = {
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  metadata: { userId: "user-1" },
};

// The signature-verification-failure test exercises the handler's catch block,
// which logs via console.error. Silence it so the expected log doesn't pollute
// test output.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stripe webhook handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireStripeWebhookSecret.mockReturnValue("whsec_test");
    mockReadRawBody.mockResolvedValue(
      JSON.stringify({ type: "customer.subscription.created" }),
    );
    mockGetHeader.mockReturnValue("t=1,v1=abc");
  });

  it("throws 400 when the request body is empty", async () => {
    mockReadRawBody.mockResolvedValue(null);

    await expect(
      (stripeWebhookHandler as (event: object) => Promise<unknown>)(
        buildMockEvent(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when the Stripe-Signature header is missing", async () => {
    mockGetHeader.mockReturnValue(undefined);

    await expect(
      (stripeWebhookHandler as (event: object) => Promise<unknown>)(
        buildMockEvent(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when signature verification fails", async () => {
    mockConstructStripeEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    await expect(
      (stripeWebhookHandler as (event: object) => Promise<unknown>)(
        buildMockEvent(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("calls constructStripeEvent with the raw body, signature header, and secret", async () => {
    const rawBody = JSON.stringify({ type: "customer.subscription.created" });
    mockReadRawBody.mockResolvedValue(rawBody);
    mockGetHeader.mockReturnValue("t=1,v1=abc");
    mockConstructStripeEvent.mockReturnValue({
      type: "some.unhandled.event",
      data: { object: {} },
    });

    await (stripeWebhookHandler as (event: object) => Promise<unknown>)(
      buildMockEvent(),
    );

    expect(mockConstructStripeEvent).toHaveBeenCalledWith(
      rawBody,
      "t=1,v1=abc",
      "whsec_test",
    );
  });

  it.each(["customer.subscription.created", "customer.subscription.updated"])(
    "dispatches %s to upsertSubscriptionFromStripeSubscription",
    async (eventType) => {
      mockConstructStripeEvent.mockReturnValue({
        type: eventType,
        data: { object: SUBSCRIPTION_OBJECT },
      });

      const result = await (
        stripeWebhookHandler as (event: object) => Promise<unknown>
      )(buildMockEvent());

      expect(mockUpsertSubscriptionFromStripeSubscription).toHaveBeenCalledWith(
        SUBSCRIPTION_OBJECT,
      );
      expect(mockMarkSubscriptionCanceled).not.toHaveBeenCalled();
      // A plan change can be a downgrade, so the handler reconciles the
      // public-profile entitlement for the event's user.
      expect(mockRevokePublicProfileIfPlanDisallows).toHaveBeenCalledWith(
        "user-1",
      );
      expect(result).toEqual({ ok: true });
    },
  );

  it("dispatches customer.subscription.deleted to markSubscriptionCanceled", async () => {
    mockConstructStripeEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: { object: SUBSCRIPTION_OBJECT },
    });

    const result = await (
      stripeWebhookHandler as (event: object) => Promise<unknown>
    )(buildMockEvent());

    expect(mockMarkSubscriptionCanceled).toHaveBeenCalledWith(
      SUBSCRIPTION_OBJECT,
    );
    expect(mockUpsertSubscriptionFromStripeSubscription).not.toHaveBeenCalled();
    // Cancellation drops the user to Drifter, so public discoverability is revoked.
    expect(mockRevokePublicProfileIfPlanDisallows).toHaveBeenCalledWith(
      "user-1",
    );
    expect(result).toEqual({ ok: true });
  });

  it("skips the public-profile reconcile when the subscription carries no userId", async () => {
    mockConstructStripeEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_123", metadata: {} } },
    });

    await (stripeWebhookHandler as (event: object) => Promise<unknown>)(
      buildMockEvent(),
    );

    expect(mockRevokePublicProfileIfPlanDisallows).not.toHaveBeenCalled();
  });

  it("acknowledges checkout.session.completed without dispatching to either sync function", async () => {
    mockConstructStripeEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_123" } },
    });

    const result = await (
      stripeWebhookHandler as (event: object) => Promise<unknown>
    )(buildMockEvent());

    expect(mockUpsertSubscriptionFromStripeSubscription).not.toHaveBeenCalled();
    expect(mockMarkSubscriptionCanceled).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("returns ok for unrecognized event types without dispatching anything", async () => {
    mockConstructStripeEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: {} },
    });

    const result = await (
      stripeWebhookHandler as (event: object) => Promise<unknown>
    )(buildMockEvent());

    expect(mockUpsertSubscriptionFromStripeSubscription).not.toHaveBeenCalled();
    expect(mockMarkSubscriptionCanceled).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });
});
