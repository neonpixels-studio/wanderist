/**
 * Tests for GET /api/trips/[id] — single trip with stops and facts.
 *
 * The visibility rule under test lives in the real loadReadableTrip from
 * trip-queries.ts, so it is intentionally NOT mocked — a regression there fails
 * these tests. Only optionalUser is mocked (not requireUser): the handler must
 * resolve the caller via optionalUser so anonymous reads of a public trip are
 * allowed. If it regresses to a blanket ownership check, these tests fail
 * loudly rather than silently re-gating public trips.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { callHandler } from "./_helpers";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockOptionalUser, mockGetRouterParam, mockCreateError, mockSelect } =
  vi.hoisted(() => {
    const mockOptionalUser = vi.fn();
    const mockGetRouterParam = vi.fn().mockReturnValue("trip-1");
    const mockCreateError = vi.fn(
      (options: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(options.statusMessage), options),
    );
    const mockSelect = vi.fn();

    return {
      mockOptionalUser,
      mockGetRouterParam,
      mockCreateError,
      mockSelect,
    };
  });

vi.mock("../../../server/utils/auth", () => ({
  optionalUser: mockOptionalUser,
}));

vi.mock("../../../server/db/index", () => ({
  getDb: () => ({ select: mockSelect }),
}));

const mockSetResponseHeader = vi.fn();

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: mockCreateError,
  getRouterParam: mockGetRouterParam,
  setResponseHeader: mockSetResponseHeader,
});

const { default: handler } = await import("@trips-id.get");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID = "user-1";
const OTHER_ID = "user-2";

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "trip-1",
    userId: OWNER_ID,
    name: "Iceland",
    status: "ongoing",
    startDate: null,
    endDate: null,
    distanceKm: 892,
    coverImageId: null,
    visibility: "private",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const SAMPLE_STOPS = [
  {
    id: "stop-1",
    tripId: "trip-1",
    name: "Reykjavík",
    sortOrder: 0,
    nights: 2,
    distanceKm: 100,
    status: "done",
    arriveDate: null,
    note: null,
    placeId: null,
  },
];

// The handler issues three queries in order: the trip lookup (from().where()
// .limit()), the ordered-stops query (from().where().orderBy()), then the
// photo-count query (from().innerJoin().where()). Each select() call returns the
// shape that call expects; the trip row is supplied per-test to drive the
// visibility rule.
function setupSelectChain(tripRow: Record<string, unknown> | undefined) {
  let callCount = 0;

  mockSelect.mockImplementation(() => {
    callCount++;

    if (callCount === 1) {
      const limit = vi.fn().mockResolvedValue(tripRow ? [tripRow] : []);
      const where = vi.fn(() => ({ limit }));
      const from = vi.fn(() => ({ where }));
      return { from };
    }

    if (callCount === 2) {
      const orderBy = vi.fn().mockResolvedValue(SAMPLE_STOPS);
      const where = vi.fn(() => ({ orderBy }));
      const from = vi.fn(() => ({ where }));
      return { from };
    }

    const where = vi.fn().mockResolvedValue([{ total: 5 }]);
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    return { from };
  });
}

function buildEvent(userId: string | null) {
  return { context: { userId } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/trips/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockReturnValue("trip-1");
  });

  it("returns trip, stops, and facts for the owner's private trip", async () => {
    mockOptionalUser.mockReturnValue(OWNER_ID);
    setupSelectChain(makeTrip({ visibility: "private", userId: OWNER_ID }));

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(OWNER_ID),
    )) as {
      trip: { id: string };
      stops: unknown[];
      facts: { photoCount: number };
    };

    expect(result.trip).toMatchObject({ id: "trip-1" });
    expect(result.stops).toHaveLength(1);
    expect(result.facts.photoCount).toBe(5);
  });

  it("returns a public trip to a signed-in non-owner", async () => {
    mockOptionalUser.mockReturnValue(OTHER_ID);
    setupSelectChain(makeTrip({ visibility: "public", userId: OWNER_ID }));

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(OTHER_ID),
    )) as { trip: { id: string } };

    expect(result.trip).toMatchObject({ id: "trip-1" });
  });

  it("returns a public trip to an anonymous visitor", async () => {
    mockOptionalUser.mockReturnValue(null);
    setupSelectChain(makeTrip({ visibility: "public", userId: OWNER_ID }));

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(null),
    )) as { trip: { id: string } };

    expect(result.trip).toMatchObject({ id: "trip-1" });
  });

  it("hides a private trip from a signed-in non-owner with a 404", async () => {
    mockOptionalUser.mockReturnValue(OTHER_ID);
    setupSelectChain(makeTrip({ visibility: "private", userId: OWNER_ID }));

    await expect(
      callHandler(handler, buildEvent(OTHER_ID)),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("hides a private trip from an anonymous visitor with a 404", async () => {
    mockOptionalUser.mockReturnValue(null);
    setupSelectChain(makeTrip({ visibility: "private", userId: OWNER_ID }));

    await expect(callHandler(handler, buildEvent(null))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("throws 404 when the trip does not exist", async () => {
    mockOptionalUser.mockReturnValue(OWNER_ID);
    setupSelectChain(undefined);

    await expect(
      callHandler(handler, buildEvent(OWNER_ID)),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 400 when no trip id is provided", async () => {
    mockGetRouterParam.mockReturnValue(undefined);
    mockOptionalUser.mockReturnValue(OWNER_ID);
    setupSelectChain(makeTrip());

    await expect(
      callHandler(handler, buildEvent(OWNER_ID)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("computes loggedDistanceKm and nights from stop data", async () => {
    mockOptionalUser.mockReturnValue(OWNER_ID);
    setupSelectChain(makeTrip({ userId: OWNER_ID }));

    const result = (await (handler as (event: object) => unknown)(
      buildEvent(OWNER_ID),
    )) as { facts: { loggedDistanceKm: number | null; nights: number | null } };

    expect(result.facts.loggedDistanceKm).toBe(100);
    expect(result.facts.nights).toBe(2);
  });

  it("marks the response private/uncacheable and varies on Authorization", async () => {
    mockOptionalUser.mockReturnValue(null);
    setupSelectChain(makeTrip({ visibility: "public", userId: OWNER_ID }));

    await (handler as (event: object) => unknown)(buildEvent(null));

    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "private, no-store",
    );
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Vary",
      "Authorization",
    );
  });
});
