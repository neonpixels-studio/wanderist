/**
 * Unit tests for server/utils/planLimits.ts.
 *
 * getEffectivePlan and the database are mocked so no network or database
 * access is needed, and each test can pin the "current plan" directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  userPreferences,
  PLAN,
  SUBSCRIPTION_STATUS,
} from "../../server/db/schema";
import type {
  Plan,
  SubscriptionStatus,
} from "../../server/utils/subscriptions";

vi.stubGlobal(
  "createError",
  (options: { statusCode: number; statusMessage: string }) => {
    const error = new Error(options.statusMessage) as Error & {
      statusCode: number;
      statusMessage: string;
    };
    error.statusCode = options.statusCode;
    error.statusMessage = options.statusMessage;
    return error;
  },
);

const {
  mockGetEffectivePlan,
  mockGetSubscriptionForUser,
  mockWhere,
  mockFrom,
  mockSelect,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
  mockGetDb,
} = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue([{ value: 0 }]);
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  const mockGetDb = vi.fn(() => ({ select: mockSelect, update: mockUpdate }));

  return {
    mockGetEffectivePlan: vi.fn(),
    mockGetSubscriptionForUser: vi.fn(),
    mockWhere,
    mockFrom,
    mockSelect,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    mockGetDb,
  };
});

vi.mock("../../server/utils/subscriptions", () => ({
  getEffectivePlan: mockGetEffectivePlan,
  getSubscriptionForUser: mockGetSubscriptionForUser,
}));

vi.mock("../../server/db/index", () => ({
  getDb: mockGetDb,
}));

const {
  PLAN_LIMITS,
  MAP_STYLES,
  assertPlaceLimit,
  assertActiveTripLimit,
  assertPhotoLimit,
  assertInstagramSyncAllowed,
  assertMapStyleAllowed,
  assertPublicProfileAllowed,
  revokePublicProfileOnCancellation,
  revokePublicProfileOnDowngrade,
} = await import("../../server/utils/planLimits");

function setCount(value: number): void {
  mockWhere.mockResolvedValue([{ value }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setCount(0);
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockUpdateWhere.mockResolvedValue(undefined);
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
});

describe("PLAN_LIMITS", () => {
  it("matches the advertised /pricing limits for the free Drifter plan", () => {
    expect(PLAN_LIMITS.drifter).toMatchObject({
      maxPlaces: 25,
      maxActiveTrips: 1,
      maxPhotos: 100,
      instagramSyncAllowed: false,
      publicProfileAllowed: false,
    });
    expect(PLAN_LIMITS.drifter.mapStyles).toEqual(["outdoors"]);
  });

  it("gives Wanderer and Nomad unlimited counts and all map styles", () => {
    for (const plan of ["wanderer", "nomad"] as const) {
      expect(PLAN_LIMITS[plan].maxPlaces).toBeNull();
      expect(PLAN_LIMITS[plan].maxActiveTrips).toBeNull();
      expect(PLAN_LIMITS[plan].maxPhotos).toBeNull();
      expect(PLAN_LIMITS[plan].instagramSyncAllowed).toBe(true);
      expect(PLAN_LIMITS[plan].mapStyles).toEqual(MAP_STYLES);
    }
  });

  it("only Nomad allows a public traveler profile", () => {
    expect(PLAN_LIMITS.drifter.publicProfileAllowed).toBe(false);
    expect(PLAN_LIMITS.wanderer.publicProfileAllowed).toBe(false);
    expect(PLAN_LIMITS.nomad.publicProfileAllowed).toBe(true);
  });
});

describe("assertPlaceLimit", () => {
  it("does not throw when under the Drifter limit", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    setCount(24);
    await expect(assertPlaceLimit("user-1")).resolves.toBeUndefined();
  });

  it("throws 402 when at the Drifter limit", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    setCount(25);
    await expect(assertPlaceLimit("user-1")).rejects.toMatchObject({
      statusCode: 402,
    });
  });

  it("never throws for an unlimited plan regardless of count", async () => {
    mockGetEffectivePlan.mockResolvedValue("nomad");
    setCount(10_000);
    await expect(assertPlaceLimit("user-1")).resolves.toBeUndefined();
  });
});

describe("assertActiveTripLimit", () => {
  it("throws 402 when at the Drifter active-trip limit", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    setCount(1);
    await expect(assertActiveTripLimit("user-1")).rejects.toMatchObject({
      statusCode: 402,
    });
  });

  it("does not throw when under the limit", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    setCount(0);
    await expect(assertActiveTripLimit("user-1")).resolves.toBeUndefined();
  });
});

describe("assertPhotoLimit", () => {
  it("throws 402 when at the Drifter photo-storage limit", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    setCount(100);
    await expect(assertPhotoLimit("user-1")).rejects.toMatchObject({
      statusCode: 402,
    });
  });

  it("does not throw for Wanderer regardless of count", async () => {
    mockGetEffectivePlan.mockResolvedValue("wanderer");
    setCount(100);
    await expect(assertPhotoLimit("user-1")).resolves.toBeUndefined();
  });
});

describe("assertInstagramSyncAllowed", () => {
  it("throws 402 on the Drifter plan", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    await expect(assertInstagramSyncAllowed("user-1")).rejects.toMatchObject({
      statusCode: 402,
    });
  });

  it("does not throw on Wanderer or Nomad", async () => {
    for (const plan of ["wanderer", "nomad"]) {
      mockGetEffectivePlan.mockResolvedValue(plan);
      await expect(
        assertInstagramSyncAllowed("user-1"),
      ).resolves.toBeUndefined();
    }
  });
});

describe("assertMapStyleAllowed", () => {
  it("allows 'outdoors' on the Drifter plan", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    await expect(
      assertMapStyleAllowed("user-1", "outdoors"),
    ).resolves.toBeUndefined();
  });

  it("throws 402 for a non-default style on the Drifter plan", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    await expect(
      assertMapStyleAllowed("user-1", "satellite"),
    ).rejects.toMatchObject({ statusCode: 402 });
  });

  it("allows any map style on Nomad", async () => {
    mockGetEffectivePlan.mockResolvedValue("nomad");
    for (const style of MAP_STYLES) {
      await expect(
        assertMapStyleAllowed("user-1", style),
      ).resolves.toBeUndefined();
    }
  });
});

describe("assertPublicProfileAllowed", () => {
  it("never throws when turning the profile off, regardless of plan", async () => {
    mockGetEffectivePlan.mockResolvedValue("drifter");
    await expect(
      assertPublicProfileAllowed("user-1", false),
    ).resolves.toBeUndefined();
    expect(mockGetEffectivePlan).not.toHaveBeenCalled();
  });

  it("throws 402 turning the profile on for Drifter and Wanderer", async () => {
    for (const plan of ["drifter", "wanderer"]) {
      mockGetEffectivePlan.mockResolvedValue(plan);
      await expect(
        assertPublicProfileAllowed("user-1", true),
      ).rejects.toMatchObject({ statusCode: 402 });
    }
  });

  it("allows turning the profile on for Nomad", async () => {
    mockGetEffectivePlan.mockResolvedValue("nomad");
    await expect(
      assertPublicProfileAllowed("user-1", true),
    ).resolves.toBeUndefined();
  });
});

function setSubscription(status: SubscriptionStatus, plan: Plan): void {
  mockGetSubscriptionForUser.mockResolvedValue({
    plan,
    status,
    billingCycle: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
}

describe("revokePublicProfileOnCancellation", () => {
  it("clears the public-profile flag unconditionally (cancellation → Drifter)", async () => {
    await revokePublicProfileOnCancellation("user-1");

    // Clearing this stored boolean is what removes the user from the public read
    // paths (profile, followers, discover, search), which gate on it. No row
    // read is needed — cancellation is terminal.
    expect(mockGetSubscriptionForUser).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ publicProfile: false });
  });

  it("only clears rows for the given user that currently carry the flag", async () => {
    await revokePublicProfileOnCancellation("user-42");

    // Assert the full predicate: without the userId scope this would clear
    // publicProfile for every user in the table, and without the publicProfile
    // guard it would rewrite already-private rows on every webhook.
    expect(mockUpdateWhere).toHaveBeenCalledWith(
      and(
        eq(userPreferences.userId, "user-42"),
        eq(userPreferences.publicProfile, true),
      ),
    );
  });
});

describe("revokePublicProfileOnDowngrade", () => {
  it("clears the flag on an active downgrade to Wanderer (Nomad → Wanderer)", async () => {
    setSubscription(SUBSCRIPTION_STATUS.ACTIVE, PLAN.WANDERER);

    await revokePublicProfileOnDowngrade("user-1");

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ publicProfile: false });
  });

  it("leaves the flag untouched on active Nomad so an upgrade/renewal never clears a valid opt-in", async () => {
    setSubscription(SUBSCRIPTION_STATUS.ACTIVE, PLAN.NOMAD);

    await revokePublicProfileOnDowngrade("user-1");

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("preserves a paused Nomad's opt-in (paused collapses to canceled but is recoverable)", async () => {
    // The finding this guards: mapStripeSubscriptionStatus collapses the
    // recoverable `paused` (pause_collection) into `canceled`. A Nomad who pauses
    // must keep their public-profile opt-in, since the clear is irreversible.
    setSubscription(SUBSCRIPTION_STATUS.CANCELED, PLAN.NOMAD);

    await revokePublicProfileOnDowngrade("user-1");

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("never acts on a non-active status even when the stored plan disallows the profile (the ACTIVE guard is load-bearing)", async () => {
    // past_due/paused/incomplete all reach here as a non-active status. Even
    // paired with a disallowing plan, the .updated path must not perform the
    // irreversible clear — only the terminal .deleted event does. Uses Wanderer
    // (disallows) so this fails if the ACTIVE guard is removed, rather than
    // passing for the wrong reason on a plan that happens to allow the profile.
    setSubscription(SUBSCRIPTION_STATUS.PAST_DUE, PLAN.WANDERER);

    await revokePublicProfileOnDowngrade("user-1");

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("scopes the read to the given user id", async () => {
    setSubscription(SUBSCRIPTION_STATUS.ACTIVE, PLAN.WANDERER);

    await revokePublicProfileOnDowngrade("user-42");

    expect(mockGetSubscriptionForUser).toHaveBeenCalledWith("user-42");
    expect(mockUpdateWhere).toHaveBeenCalledWith(
      and(
        eq(userPreferences.userId, "user-42"),
        eq(userPreferences.publicProfile, true),
      ),
    );
  });
});
