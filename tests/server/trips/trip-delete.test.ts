/**
 * Tests for DELETE /api/trips/[id]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeOwnershipError, callHandler } from "./_helpers";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockLoadOwnedTrip,
  mockGetRouterParam,
  mockCreateError,
  mockBatch,
  mockDelete,
  mockWhere,
  mockSelect,
  mockSelectFrom,
  mockSelectInnerJoin,
  mockSelectWhere,
  mockDeleteMediaIfUnreferenced,
} = vi.hoisted(() => {
  // where() is the terminal of each delete builder; batch() receives the built
  // statements and resolves them together (neon-http runs a batch as one
  // server-side transaction).
  const mockWhere = vi.fn(() => Promise.resolve(undefined));
  const mockDelete = vi.fn(() => ({ where: mockWhere }));
  const mockBatch = vi.fn((statements: unknown[]) => Promise.all(statements));

  // select(photos).from().innerJoin(entries).where() — collects the media ids
  // for every entry photo under the trip before the delete removes them.
  const mockSelectWhere = vi.fn().mockResolvedValue([]);
  const mockSelectInnerJoin = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelectFrom = vi.fn(() => ({ innerJoin: mockSelectInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

  return {
    mockLoadOwnedTrip: vi.fn().mockResolvedValue({ id: "trip-1" }),
    mockGetRouterParam: vi.fn().mockReturnValue("trip-1"),
    mockCreateError: vi.fn(
      (options: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(options.statusMessage), options),
    ),
    mockBatch,
    mockDelete,
    mockWhere,
    mockSelect,
    mockSelectFrom,
    mockSelectInnerJoin,
    mockSelectWhere,
    mockDeleteMediaIfUnreferenced: vi.fn().mockResolvedValue(true),
  };
});

// eq/and return identifiable tokens so the delete predicates can be asserted
// on the exact argument each `where` received — not just "eq was called
// somewhere" (the collect query also calls eq, so a bare eq spy proves nothing
// about the delete).
vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    eq: vi.fn((left: unknown, right: unknown) => ({ __eq: [left, right] })),
    and: vi.fn((...conditions: unknown[]) => ({ __and: conditions })),
  };
});

vi.mock("../../../server/utils/trip-helpers", () => ({
  requireTripId: (event: object) => {
    const id = mockGetRouterParam(event, "id");
    if (!id) {
      throw mockCreateError({
        statusCode: 400,
        statusMessage: "Trip id is required",
      });
    }
    return id;
  },
  loadOwnedTrip: mockLoadOwnedTrip,
}));

vi.mock("../../../server/db/index", () => ({
  getDb: () => ({
    select: mockSelect,
    delete: mockDelete,
    batch: mockBatch,
  }),
}));

vi.mock("../../../server/utils/coverImageCleanup", () => ({
  deleteMediaIfUnreferenced: mockDeleteMediaIfUnreferenced,
}));

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: mockCreateError,
  getRouterParam: mockGetRouterParam,
});

import { trips, entries, entryPhotos } from "../../../server/db/schema";

const { default: handler } = await import("@trips-id.delete");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function buildEvent() {
  return { context: { userId: "user-1" } };
}

const ownedEntriesFilter = {
  __and: [
    { __eq: [entries.tripId, "trip-1"] },
    { __eq: [entries.userId, "user-1"] },
  ],
};

describe("DELETE /api/trips/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockReturnValue("trip-1");
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockWhere.mockImplementation(() => Promise.resolve(undefined));
    mockDelete.mockReturnValue({ where: mockWhere });
    mockBatch.mockImplementation((statements: unknown[]) =>
      Promise.all(statements),
    );
    mockSelectWhere.mockResolvedValue([]);
    mockSelectInnerJoin.mockReturnValue({ where: mockSelectWhere });
    mockSelectFrom.mockReturnValue({ innerJoin: mockSelectInnerJoin });
    mockSelect.mockReturnValue({ from: mockSelectFrom });
    mockDeleteMediaIfUnreferenced.mockResolvedValue(true);
  });

  it("deletes the trip and returns ok", async () => {
    const result = await callHandler(handler, buildEvent());

    expect(mockLoadOwnedTrip).toHaveBeenCalledTimes(1);
    expect(mockBatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it("deletes the owner's entries and the trip in one batch", async () => {
    await callHandler(handler, buildEvent());

    expect(mockBatch).toHaveBeenCalledTimes(1);
    const statements = mockBatch.mock.calls[0][0] as unknown[];
    expect(statements).toHaveLength(2);

    // Entries delete first, scoped to trip AND owner; trip delete second.
    expect(mockDelete.mock.calls[0][0]).toBe(entries);
    expect(mockWhere.mock.calls[0][0]).toEqual(ownedEntriesFilter);
    expect(mockDelete.mock.calls[1][0]).toBe(trips);
    expect(mockWhere.mock.calls[1][0]).toEqual({ __eq: [trips.id, "trip-1"] });
  });

  it("scopes the photo lookup to this trip's entry photos for the owner", async () => {
    await callHandler(handler, buildEvent());

    expect(mockSelectFrom).toHaveBeenCalledWith(entryPhotos);
    expect(mockSelectInnerJoin).toHaveBeenCalledWith(entries, {
      __eq: [entryPhotos.entryId, entries.id],
    });
    expect(mockSelectWhere).toHaveBeenCalledWith(ownedEntriesFilter);
  });

  it("verifies ownership before deleting", async () => {
    await callHandler(handler, buildEvent());

    const ownershipOrder = mockLoadOwnedTrip.mock.invocationCallOrder[0];
    const batchOrder = mockBatch.mock.invocationCallOrder[0];
    expect(ownershipOrder).toBeLessThan(batchOrder);
  });

  it("throws 400 when trip id is missing", async () => {
    mockGetRouterParam.mockReturnValue(undefined);

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 404 when the trip does not belong to the user", async () => {
    mockLoadOwnedTrip.mockRejectedValue(makeOwnershipError());

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("cleans up the trip's cover media when it has one", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-1",
    });

    await callHandler(handler, buildEvent());

    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "media-1",
    );
  });

  it("deletes the trip before cleaning up its cover media", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-1",
    });

    await callHandler(handler, buildEvent());

    const batchOrder = mockBatch.mock.invocationCallOrder[0];
    const cleanupOrder =
      mockDeleteMediaIfUnreferenced.mock.invocationCallOrder[0];
    expect(batchOrder).toBeLessThan(cleanupOrder);
  });

  it("does not clean up media when the trip has no cover", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });

    await callHandler(handler, buildEvent());

    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("does not clean up media when the batch delete throws", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-1",
    });
    mockBatch.mockRejectedValue(new Error("db down"));

    await expect(callHandler(handler, buildEvent())).rejects.toThrow("db down");
    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("still returns ok and logs when cover cleanup fails", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "media-1",
    });
    mockDeleteMediaIfUnreferenced.mockRejectedValue(new Error("blob down"));
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await callHandler(handler, buildEvent());

    expect(result).toEqual({ ok: true });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("media-1"),
      expect.any(Error),
    );

    logSpy.mockRestore();
  });

  it("cleans up each distinct entry-photo media under the trip", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockSelectWhere.mockResolvedValue([
      { mediaId: "photo-1" },
      { mediaId: "photo-2" },
      { mediaId: "photo-1" },
    ]);

    await callHandler(handler, buildEvent());

    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledTimes(2);
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "photo-1",
    );
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "photo-2",
    );
  });

  it("reconciles both the cover and the photo media in one request, without double-cleaning a shared media", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: "photo-1",
    });
    // photo-1 is also the cover; it must be reconciled once (via the cover
    // path), not once per path.
    mockSelectWhere.mockResolvedValue([
      { mediaId: "photo-1" },
      { mediaId: "photo-2" },
    ]);

    const result = await callHandler(handler, buildEvent());

    expect(result).toEqual({ ok: true });
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledTimes(2);
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "photo-1",
    );
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "photo-2",
    );
  });

  it("does not clean up photo media when the trip has no entry photos", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockSelectWhere.mockResolvedValue([]);

    await callHandler(handler, buildEvent());

    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("collects the photo media ids before deleting the trip", async () => {
    mockSelectWhere.mockResolvedValue([{ mediaId: "photo-1" }]);

    await callHandler(handler, buildEvent());

    const selectOrder = mockSelect.mock.invocationCallOrder[0];
    const batchOrder = mockBatch.mock.invocationCallOrder[0];
    expect(selectOrder).toBeLessThan(batchOrder);
  });

  it("deletes the trip before cleaning up its photo media", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockSelectWhere.mockResolvedValue([{ mediaId: "photo-1" }]);

    await callHandler(handler, buildEvent());

    const batchOrder = mockBatch.mock.invocationCallOrder[0];
    const cleanupOrder =
      mockDeleteMediaIfUnreferenced.mock.invocationCallOrder[0];
    expect(batchOrder).toBeLessThan(cleanupOrder);
  });

  it("cleans up every media across multiple concurrency chunks", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    const mediaIds = Array.from({ length: 17 }, (_, index) => `photo-${index}`);
    mockSelectWhere.mockResolvedValue(mediaIds.map((mediaId) => ({ mediaId })));

    await callHandler(handler, buildEvent());

    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledTimes(17);
    const cleaned = mockDeleteMediaIfUnreferenced.mock.calls.map(
      (call) => call[2],
    );
    expect(cleaned).toEqual(expect.arrayContaining(mediaIds));
  });

  it("tallies a failure that lands in a later concurrency chunk", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    const mediaIds = Array.from({ length: 17 }, (_, index) => `photo-${index}`);
    mockSelectWhere.mockResolvedValue(mediaIds.map((mediaId) => ({ mediaId })));
    // photo-16 is the sole member of the final chunk (chunk size 8).
    mockDeleteMediaIfUnreferenced.mockImplementation(
      async (_database: unknown, _ownerId: unknown, mediaId: unknown) => {
        if (mediaId === "photo-16") {
          throw new Error("blob down");
        }
        return true;
      },
    );
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await callHandler(handler, buildEvent());

    expect(result).toEqual({ ok: true });
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledTimes(17);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "1 of 17 photo media cleanups failed for trip trip-1",
      ),
    );

    logSpy.mockRestore();
  });

  it("does not open the delete batch when the photo lookup throws", async () => {
    mockSelectWhere.mockRejectedValue(new Error("db down"));

    await expect(callHandler(handler, buildEvent())).rejects.toThrow("db down");
    expect(mockBatch).not.toHaveBeenCalled();
  });

  it("does not clean up photo media when the batch delete throws", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockSelectWhere.mockResolvedValue([{ mediaId: "photo-1" }]);
    mockBatch.mockRejectedValue(new Error("db down"));

    await expect(callHandler(handler, buildEvent())).rejects.toThrow("db down");
    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("still returns ok and logs when a photo media cleanup fails", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockSelectWhere.mockResolvedValue([{ mediaId: "photo-1" }]);
    mockDeleteMediaIfUnreferenced.mockRejectedValue(new Error("blob down"));
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await callHandler(handler, buildEvent());

    expect(result).toEqual({ ok: true });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("photo-1"),
      expect.any(Error),
    );

    logSpy.mockRestore();
  });

  it("cleans up the remaining photo media when one cleanup fails", async () => {
    mockLoadOwnedTrip.mockResolvedValue({
      id: "trip-1",
      userId: "user-1",
      coverImageId: null,
    });
    mockSelectWhere.mockResolvedValue([
      { mediaId: "photo-1" },
      { mediaId: "photo-2" },
    ]);
    mockDeleteMediaIfUnreferenced.mockImplementation(
      async (_database: unknown, _ownerId: unknown, mediaId: unknown) => {
        if (mediaId === "photo-1") {
          throw new Error("blob down");
        }
        return true;
      },
    );
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await callHandler(handler, buildEvent());

    expect(result).toEqual({ ok: true });
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "photo-2",
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "1 of 2 photo media cleanups failed for trip trip-1",
      ),
    );

    logSpy.mockRestore();
  });
});
