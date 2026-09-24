/**
 * Tests for PATCH /api/trips/[id]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeOwnershipError, callHandler } from "./_helpers";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockLoadOwnedOrThrow,
  mockGetRouterParam,
  mockReadBody,
  mockCreateError,
  mockUpdate,
  mockSet,
  mockWhere,
  mockReturning,
} = vi.hoisted(() => {
  const UPDATED_TRIP = {
    id: "trip-1",
    userId: "user-1",
    name: "Updated Name",
    status: "ongoing",
    visibility: "private",
    startDate: null,
    endDate: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockReturning = vi.fn().mockResolvedValue([UPDATED_TRIP]);
  const mockWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));

  const mockLoadOwnedOrThrow = vi.fn().mockResolvedValue({
    id: "trip-1",
    userId: "user-1",
    name: "Original",
  });

  return {
    mockLoadOwnedOrThrow,
    mockGetRouterParam: vi.fn().mockReturnValue("trip-1"),
    mockReadBody: vi.fn().mockResolvedValue({ name: "Updated Name" }),
    mockCreateError: vi.fn(
      (options: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(options.statusMessage), options),
    ),
    mockUpdate,
    mockSet,
    mockWhere,
    mockReturning,
  };
});

vi.mock("../../../server/utils/db-helpers", () => ({
  loadOwnedOrThrow: mockLoadOwnedOrThrow,
  optionalString: vi.fn((value: unknown) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== "string") {
      throw Object.assign(new Error("must be a string"), { statusCode: 400 });
    }

    return value;
  }),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: () => ({ update: mockUpdate }),
}));

const mockDeleteMediaIfUnreferenced = vi.fn().mockResolvedValue(true);
const mockAssertCoverImageOwned = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../server/utils/coverImageCleanup", () => ({
  deleteMediaIfUnreferenced: mockDeleteMediaIfUnreferenced,
  assertCoverImageOwned: mockAssertCoverImageOwned,
}));

const mockAssertActiveTripLimit = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../server/utils/planLimits", () => ({
  assertActiveTripLimit: mockAssertActiveTripLimit,
}));

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: mockCreateError,
  getRouterParam: mockGetRouterParam,
  readBody: mockReadBody,
});

const { default: handler } = await import("@trips-id.patch");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function buildEvent() {
  return { context: { userId: "user-1" } };
}

const UPDATED_TRIP = {
  id: "trip-1",
  userId: "user-1",
  name: "Updated Name",
  status: "ongoing",
  visibility: "private",
  startDate: null,
  endDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("PATCH /api/trips/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockReturnValue("trip-1");
    mockLoadOwnedOrThrow.mockResolvedValue({ id: "trip-1", userId: "user-1" });
    mockReadBody.mockResolvedValue({ name: "Updated Name" });
    mockReturning.mockResolvedValue([UPDATED_TRIP]);
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockSet.mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
    mockDeleteMediaIfUnreferenced.mockResolvedValue(true);
    mockAssertCoverImageOwned.mockResolvedValue(undefined);
    mockAssertActiveTripLimit.mockResolvedValue(undefined);
  });

  it("updates and returns the trip", async () => {
    const result = await callHandler(handler, buildEvent());

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Updated Name" }),
    );
    expect(result).toMatchObject({ name: "Updated Name" });
  });

  it("verifies ownership before updating", async () => {
    await callHandler(handler, buildEvent());

    const ownershipOrder = mockLoadOwnedOrThrow.mock.invocationCallOrder[0];
    const updateOrder = mockUpdate.mock.invocationCallOrder[0];
    expect(ownershipOrder).toBeLessThan(updateOrder);
  });

  it("throws 400 when no valid fields are provided", async () => {
    mockReadBody.mockResolvedValue({});

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 for an invalid status value", async () => {
    mockReadBody.mockResolvedValue({ status: "bad-status" });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 for an invalid visibility value", async () => {
    mockReadBody.mockResolvedValue({ visibility: "secret" });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 for an invalid date string", async () => {
    mockReadBody.mockResolvedValue({ startDate: "not-a-date" });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when trip id is missing", async () => {
    mockGetRouterParam.mockReturnValue(undefined);

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 404 when the trip does not belong to the user", async () => {
    mockLoadOwnedOrThrow.mockRejectedValue(makeOwnershipError());

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("accepts null dates to clear start/end date", async () => {
    mockReadBody.mockResolvedValue({ startDate: null });
    mockReturning.mockResolvedValue([{ ...UPDATED_TRIP, startDate: null }]);

    await callHandler(handler, buildEvent());

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: null }),
    );
  });

  it("throws 400 when endDate is before startDate (both in patch)", async () => {
    mockReadBody.mockResolvedValue({
      startDate: "2026-07-10T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when patching only endDate earlier than existing startDate", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      startDate: new Date("2026-07-10T00:00:00.000Z"),
    });
    mockReadBody.mockResolvedValue({ endDate: "2026-07-01T00:00:00.000Z" });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when patching only startDate later than existing endDate", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      endDate: new Date("2026-07-01T00:00:00.000Z"),
    });
    mockReadBody.mockResolvedValue({ startDate: "2026-07-10T00:00:00.000Z" });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("trims whitespace from name before storing", async () => {
    mockReadBody.mockResolvedValue({ name: "  Iceland  " });

    await callHandler(handler, buildEvent());

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Iceland" }),
    );
  });

  it("cleans up the previous cover media when coverImageId changes", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-old",
    });
    mockReadBody.mockResolvedValue({ coverImageId: "media-new" });

    await callHandler(handler, buildEvent());

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ coverImageId: "media-new" }),
    );
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "media-old",
    );
  });

  it("updates the trip before cleaning up the previous cover", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-old",
    });
    mockReadBody.mockResolvedValue({ coverImageId: "media-new" });

    await callHandler(handler, buildEvent());

    const updateOrder = mockUpdate.mock.invocationCallOrder[0];
    const cleanupOrder =
      mockDeleteMediaIfUnreferenced.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(cleanupOrder);
  });

  it("cleans up the previous cover media when coverImageId is cleared to null", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-old",
    });
    mockReadBody.mockResolvedValue({ coverImageId: null });
    mockReturning.mockResolvedValue([{ ...UPDATED_TRIP, coverImageId: null }]);

    await callHandler(handler, buildEvent());

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ coverImageId: null }),
    );
    expect(mockAssertCoverImageOwned).not.toHaveBeenCalled();
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "media-old",
    );
  });

  it("does not clean up when the cover image is unchanged", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-same",
    });
    mockReadBody.mockResolvedValue({ coverImageId: "media-same" });

    await callHandler(handler, buildEvent());

    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("does not clean up when there was no previous cover image", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockReadBody.mockResolvedValue({ coverImageId: "media-new" });

    await callHandler(handler, buildEvent());

    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("trims whitespace from coverImageId before storing", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockReadBody.mockResolvedValue({ coverImageId: "  media-new  " });

    await callHandler(handler, buildEvent());

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ coverImageId: "media-new" }),
    );
  });

  it("rejects an empty-string coverImageId with 400", async () => {
    mockReadBody.mockResolvedValue({ coverImageId: "" });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a whitespace-only coverImageId with 400", async () => {
    mockReadBody.mockResolvedValue({ coverImageId: "   " });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a non-string coverImageId with 400", async () => {
    mockReadBody.mockResolvedValue({ coverImageId: 123 });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a coverImageId the user does not own with the assertion's error", async () => {
    mockReadBody.mockResolvedValue({ coverImageId: "media-new" });
    mockAssertCoverImageOwned.mockRejectedValue(
      Object.assign(new Error("Cover image not found"), { statusCode: 404 }),
    );

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still returns the updated trip when cover cleanup fails", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-old",
    });
    mockReadBody.mockResolvedValue({ coverImageId: "media-new" });
    mockReturning.mockResolvedValue([
      { ...UPDATED_TRIP, coverImageId: "media-new" },
    ]);
    mockDeleteMediaIfUnreferenced.mockRejectedValue(new Error("blob down"));

    const result = await callHandler(handler, buildEvent());

    expect(result).toMatchObject({ coverImageId: "media-new" });
  });

  describe("active-trip limit re-check", () => {
    it("re-checks the limit when a patch would revive a past trip into active", async () => {
      mockLoadOwnedOrThrow.mockResolvedValue({
        id: "trip-1",
        userId: "user-1",
        status: "past",
        endDate: null,
      });
      mockReadBody.mockResolvedValue({ status: "upcoming" });

      await callHandler(handler, buildEvent());

      expect(mockAssertActiveTripLimit).toHaveBeenCalledWith("user-1");
    });

    it("re-checks the limit when a patch would move a stale trip's endDate back into the future", async () => {
      mockLoadOwnedOrThrow.mockResolvedValue({
        id: "trip-1",
        userId: "user-1",
        status: "ongoing",
        endDate: new Date("2000-01-01"),
      });
      mockReadBody.mockResolvedValue({ endDate: "2099-01-01T00:00:00.000Z" });

      await callHandler(handler, buildEvent());

      expect(mockAssertActiveTripLimit).toHaveBeenCalledWith("user-1");
    });

    it("propagates a 402 when reviving a trip would exceed the plan's active-trip limit", async () => {
      mockLoadOwnedOrThrow.mockResolvedValue({
        id: "trip-1",
        userId: "user-1",
        status: "past",
        endDate: null,
      });
      mockReadBody.mockResolvedValue({ status: "ongoing" });
      mockAssertActiveTripLimit.mockRejectedValue(
        Object.assign(new Error("Plan limit reached"), { statusCode: 402 }),
      );

      await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
        statusCode: 402,
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("does not re-check the limit when the trip is already active before and after the patch", async () => {
      mockLoadOwnedOrThrow.mockResolvedValue({
        id: "trip-1",
        userId: "user-1",
        status: "ongoing",
        endDate: null,
      });
      mockReadBody.mockResolvedValue({ name: "Renamed" });

      await callHandler(handler, buildEvent());

      expect(mockAssertActiveTripLimit).not.toHaveBeenCalled();
    });

    it("does not re-check the limit when patching a past trip that stays past", async () => {
      mockLoadOwnedOrThrow.mockResolvedValue({
        id: "trip-1",
        userId: "user-1",
        status: "past",
        endDate: null,
      });
      mockReadBody.mockResolvedValue({ name: "Renamed" });

      await callHandler(handler, buildEvent());

      expect(mockAssertActiveTripLimit).not.toHaveBeenCalled();
    });
  });
});
