/**
 * Unit tests for loadReadableTrip — the trip read-visibility rule, in isolation.
 *
 * loadReadableTrip takes a pre-built database instance, so these tests drive it
 * with a fake db that returns a queued trip row. createError is the Nitro
 * auto-import, stubbed globally so the 404 branches produce inspectable errors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateError = vi.fn(
  (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
);

Object.assign(globalThis, { createError: mockCreateError });

// Imported dynamically after the createError global is installed so the module
// evaluates with the stub in place (a static import hoists above the assign).
const { loadReadableTrip } = await import("../../server/utils/trip-queries");

const OWNER_ID = "user-owner";
const OTHER_ID = "user-other";

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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Fake db exposing only the select().from().where().limit() chain
// loadReadableTrip uses; limit resolves the supplied row (or empty for "not
// found").
function makeDb(row: Record<string, unknown> | undefined) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select } as never;
}

describe("loadReadableTrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the owner's private trip", async () => {
    const trip = makeTrip({ visibility: "private", userId: OWNER_ID });

    const result = await loadReadableTrip(makeDb(trip), "trip-1", OWNER_ID);

    expect(result).toEqual(trip);
  });

  it("returns a public trip to a signed-in non-owner", async () => {
    const trip = makeTrip({ visibility: "public", userId: OWNER_ID });

    const result = await loadReadableTrip(makeDb(trip), "trip-1", OTHER_ID);

    expect(result).toEqual(trip);
  });

  it("returns a public trip to an anonymous visitor (null userId)", async () => {
    const trip = makeTrip({ visibility: "public", userId: OWNER_ID });

    const result = await loadReadableTrip(makeDb(trip), "trip-1", null);

    expect(result).toEqual(trip);
  });

  it("hides a private trip from a signed-in non-owner with a 404", async () => {
    const trip = makeTrip({ visibility: "private", userId: OWNER_ID });

    await expect(
      loadReadableTrip(makeDb(trip), "trip-1", OTHER_ID),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("hides a private trip from an anonymous visitor with a 404", async () => {
    const trip = makeTrip({ visibility: "private", userId: OWNER_ID });

    await expect(
      loadReadableTrip(makeDb(trip), "trip-1", null),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 404 when the trip does not exist", async () => {
    await expect(
      loadReadableTrip(makeDb(undefined), "missing", OWNER_ID),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("uses the same not-found message for a missing and a hidden trip", async () => {
    await loadReadableTrip(makeDb(undefined), "missing", OTHER_ID).catch(
      () => undefined,
    );
    await loadReadableTrip(
      makeDb(makeTrip({ visibility: "private" })),
      "trip-1",
      OTHER_ID,
    ).catch(() => undefined);

    const messages = mockCreateError.mock.calls.map(
      (call) => (call[0] as { statusMessage: string }).statusMessage,
    );
    expect(new Set(messages)).toEqual(new Set(["Trip not found"]));
  });
});
