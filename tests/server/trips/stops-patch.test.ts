/**
 * Tests for PATCH /api/trips/[id]/stops/[stopId]
 *
 * Uses the @trips-id-stopid.patch alias from vitest.config.ts to work around
 * vite's static import analysis rejecting bracketed path segments.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeOwnershipError, callHandler } from "./_helpers";
import { assertPlaceOwnedIfPresent } from "../../../server/utils/place-helpers";

vi.mock("../../../server/utils/place-helpers", () => ({
  assertPlaceOwnedIfPresent: vi.fn(),
}));

const mockAssertPlaceOwnedIfPresent = vi.mocked(assertPlaceOwnedIfPresent);

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockLoadOwnedOrThrow,
  mockGetRouterParam,
  mockReadBody,
  mockCreateError,
  mockOptionalString,
  mockSelect,
  mockFrom,
  mockSelectWhere,
  mockSelectLimit,
  mockUpdate,
  mockSet,
  mockUpdateWhere,
  mockUpdateReturning,
} = vi.hoisted(() => {
  const EXISTING_STOP = {
    id: "stop-1",
    tripId: "trip-1",
    name: "Old Name",
    status: "planned",
    sortOrder: 0,
    arriveDate: null,
    nights: null,
    distanceKm: null,
    note: null,
    placeId: null,
  };

  const mockUpdateReturning = vi
    .fn()
    .mockResolvedValue([{ ...EXISTING_STOP, name: "New Name" }]);
  const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
  const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));

  const mockSelectLimit = vi.fn().mockResolvedValue([EXISTING_STOP]);
  const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
  const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    mockLoadOwnedOrThrow: vi.fn().mockResolvedValue({ id: "trip-1" }),
    mockGetRouterParam: vi
      .fn()
      .mockImplementation((_, key) => (key === "id" ? "trip-1" : "stop-1")),
    mockReadBody: vi.fn().mockResolvedValue({ name: "New Name" }),
    mockCreateError: vi.fn(
      (options: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(options.statusMessage), options),
    ),
    mockOptionalString: vi.fn((value: unknown) =>
      value === undefined ? undefined : String(value),
    ),
    mockSelect,
    mockFrom,
    mockSelectWhere,
    mockSelectLimit,
    mockUpdate,
    mockSet,
    mockUpdateWhere,
    mockUpdateReturning,
  };
});

vi.mock("../../../server/utils/db-helpers", () => ({
  loadOwnedOrThrow: mockLoadOwnedOrThrow,
  optionalString: mockOptionalString,
}));

vi.mock("../../../server/db/index", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
  }),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual };
});

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: mockCreateError,
  getRouterParam: mockGetRouterParam,
  readBody: mockReadBody,
});

const { default: handler } = await import("@trips-id-stopid.patch");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function buildEvent() {
  return { context: { userId: "user-1" } };
}

describe("PATCH /api/trips/[id]/stops/[stopId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockImplementation((_, key: string) =>
      key === "id" ? "trip-1" : "stop-1",
    );
    mockLoadOwnedOrThrow.mockResolvedValue({ id: "trip-1", userId: "user-1" });
    mockReadBody.mockResolvedValue({ name: "New Name" });
    mockSelectLimit.mockResolvedValue([
      {
        id: "stop-1",
        tripId: "trip-1",
        name: "Old Name",
        status: "planned",
        sortOrder: 0,
      },
    ]);
    const updated = { id: "stop-1", tripId: "trip-1", name: "New Name" };
    mockUpdateReturning.mockResolvedValue([updated]);
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
    mockFrom.mockReturnValue({ where: mockSelectWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockOptionalString.mockImplementation((value: unknown) =>
      value === undefined ? undefined : String(value),
    );
  });

  it("updates the stop and returns the updated record", async () => {
    const result = await callHandler(handler, buildEvent());

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: "stop-1", name: "New Name" });
  });

  it("throws 400 when trip id is missing", async () => {
    mockGetRouterParam.mockImplementation((_, key: string) =>
      key === "id" ? undefined : "stop-1",
    );

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when stop id is missing", async () => {
    mockGetRouterParam.mockImplementation((_, key: string) =>
      key === "id" ? "trip-1" : undefined,
    );

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 404 when the trip is not owned by the user", async () => {
    mockLoadOwnedOrThrow.mockRejectedValue(makeOwnershipError());

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("throws 404 when the stop does not belong to the trip", async () => {
    mockSelectLimit.mockResolvedValue([]);

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("throws 400 when no valid patch fields are provided", async () => {
    mockReadBody.mockResolvedValue({});
    mockOptionalString.mockReturnValue(undefined);

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("trims whitespace from name before storing", async () => {
    mockOptionalString.mockReturnValue("  Reykjavík  ");
    mockReadBody.mockResolvedValue({ name: "  Reykjavík  " });

    await callHandler(handler, buildEvent());

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Reykjavík" }),
    );
  });

  it("throws 404 when placeId belongs to another user and does not update", async () => {
    mockReadBody.mockResolvedValue({ placeId: "place-other" });
    mockAssertPlaceOwnedIfPresent.mockRejectedValueOnce(makeOwnershipError());

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "place-other",
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("calls the place check with undefined and still updates when no placeId is supplied", async () => {
    await callHandler(handler, buildEvent());

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      undefined,
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("validates place ownership scoped to the trip owner when a placeId is supplied", async () => {
    mockReadBody.mockResolvedValue({ placeId: "place-1" });

    await callHandler(handler, buildEvent());

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "place-1",
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
