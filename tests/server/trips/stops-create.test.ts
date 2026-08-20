/**
 * Tests for POST /api/trips/[id]/stops
 *
 * The handler file lives under a Nitro-style bracketed path ([id]) which
 * vite's static import analysis cannot resolve via a bare string literal.
 * We use the @trips-id-stops-handler alias defined in vitest.config.ts to
 * let vite resolve the path without treating [ ] as glob characters.
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
  mockInsert,
  mockValues,
  mockReturning,
  mockSelect,
  mockFrom,
  mockWhere,
} = vi.hoisted(() => {
  const NEW_STOP = {
    id: "stop-new",
    tripId: "trip-1",
    name: "Reykjavík",
    status: "planned",
    sortOrder: 0,
    arriveDate: null,
    nights: null,
    distanceKm: null,
    note: null,
    placeId: null,
  };

  const mockReturning = vi.fn().mockResolvedValue([NEW_STOP]);
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  const mockWhere = vi.fn().mockResolvedValue([{ maxOrder: null }]);
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    mockLoadOwnedOrThrow: vi.fn().mockResolvedValue({ id: "trip-1" }),
    mockGetRouterParam: vi.fn().mockReturnValue("trip-1"),
    mockReadBody: vi.fn().mockResolvedValue({ name: "Reykjavík" }),
    mockCreateError: vi.fn(
      (options: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(options.statusMessage), options),
    ),
    mockInsert,
    mockValues,
    mockReturning,
    mockSelect,
    mockFrom,
    mockWhere,
  };
});

vi.mock("../../../server/utils/db-helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../server/utils/db-helpers")>();
  return {
    ...actual,
    loadOwnedOrThrow: mockLoadOwnedOrThrow,
  };
});

vi.mock("../../../server/db/index", () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
  }),
}));

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: mockCreateError,
  getRouterParam: mockGetRouterParam,
  readBody: mockReadBody,
});

// Stub crypto.randomUUID without overwriting the read-only crypto global
vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
  "stop-new" as ReturnType<typeof crypto.randomUUID>,
);

const { default: handler } = await import("@trips-id-stops-handler/index.post");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const NEW_STOP = {
  id: "stop-new",
  tripId: "trip-1",
  name: "Reykjavík",
  status: "planned",
  sortOrder: 0,
  arriveDate: null,
  nights: null,
  distanceKm: null,
  note: null,
  placeId: null,
};

function buildEvent() {
  return { context: { userId: "user-1" } };
}

describe("POST /api/trips/[id]/stops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockReturnValue("trip-1");
    mockLoadOwnedOrThrow.mockResolvedValue({ id: "trip-1", userId: "user-1" });
    mockReadBody.mockResolvedValue({ name: "Reykjavík" });
    mockWhere.mockResolvedValue([{ maxOrder: null }]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockReturning.mockResolvedValue([NEW_STOP]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "stop-new" as ReturnType<typeof crypto.randomUUID>,
    );
  });

  it("creates a stop and returns it", async () => {
    const result = await callHandler(handler, buildEvent());

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Reykjavík",
        tripId: "trip-1",
        status: "planned",
        sortOrder: 0,
      }),
    );
    expect(result).toMatchObject({ name: "Reykjavík" });
  });

  it("assigns sortOrder as one higher than existing max", async () => {
    mockWhere.mockResolvedValue([{ maxOrder: 4 }]);

    await callHandler(handler, buildEvent());

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 5 }),
    );
  });

  it("assigns sortOrder 0 when there are no existing stops", async () => {
    mockWhere.mockResolvedValue([{ maxOrder: null }]);

    await callHandler(handler, buildEvent());

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 0 }),
    );
  });

  it("throws 400 when name is missing", async () => {
    mockReadBody.mockResolvedValue({});

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 for an invalid stop status", async () => {
    mockReadBody.mockResolvedValue({ name: "Stop", status: "invalid" });

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

  it("throws 404 when placeId belongs to another user and does not insert", async () => {
    mockReadBody.mockResolvedValue({
      name: "Reykjavík",
      placeId: "place-other",
    });
    mockAssertPlaceOwnedIfPresent.mockRejectedValueOnce(makeOwnershipError());

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "place-other",
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("calls the place check with undefined and still inserts when no placeId is supplied", async () => {
    await callHandler(handler, buildEvent());

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      undefined,
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("validates place ownership scoped to the trip owner when a placeId is supplied", async () => {
    mockReadBody.mockResolvedValue({ name: "Reykjavík", placeId: "place-1" });

    await callHandler(handler, buildEvent());

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "place-1",
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
