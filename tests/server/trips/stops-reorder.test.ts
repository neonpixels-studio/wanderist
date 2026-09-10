/**
 * Tests for PUT /api/trips/[id]/stops/reorder
 *
 * The handler file lives under a Nitro-style bracketed path ([id]) which
 * vite's static import analysis cannot resolve via a bare string literal.
 * We use the @trips-id-stops-handler alias defined in vitest.config.ts to
 * let vite resolve the path without treating [ ] as glob characters.
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
  mockUpdateWhere,
  mockBatch,
  mockSelect,
  mockFrom,
  mockSelectWhere,
  mockInArray,
} = vi.hoisted(() => {
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  // The handler now issues its per-stop updates as one database.batch() call
  // instead of Promise.all — mirror that with the same "await everything,
  // reject if any one query rejects" semantics so the mocked updates above
  // still drive both the success and failure paths.
  const mockBatch = vi.fn((statements: unknown[]) => Promise.all(statements));

  const EXISTING_STOPS = [{ id: "stop-a" }, { id: "stop-b" }, { id: "stop-c" }];

  const REORDERED_STOPS = [
    { id: "stop-c", sortOrder: 0 },
    { id: "stop-a", sortOrder: 1 },
    { id: "stop-b", sortOrder: 2 },
  ];

  const mockInArray = vi.fn().mockResolvedValue(REORDERED_STOPS);
  const mockSelectWhere = vi.fn().mockResolvedValue(EXISTING_STOPS);
  const mockFrom = vi.fn(() => ({
    where: mockSelectWhere,
  }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    mockLoadOwnedOrThrow: vi.fn().mockResolvedValue({ id: "trip-1" }),
    mockGetRouterParam: vi.fn().mockReturnValue("trip-1"),
    mockReadBody: vi.fn().mockResolvedValue({
      stopIds: ["stop-c", "stop-a", "stop-b"],
    }),
    mockCreateError: vi.fn(
      (options: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(options.statusMessage), options),
    ),
    mockUpdate,
    mockSet,
    mockUpdateWhere,
    mockBatch,
    mockSelect,
    mockFrom,
    mockSelectWhere,
    mockInArray,
  };
});

vi.mock("../../../server/utils/db-helpers", () => ({
  loadOwnedOrThrow: mockLoadOwnedOrThrow,
}));

vi.mock("../../../server/db/index", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
    batch: mockBatch,
  }),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (...args: unknown[]) => {
      const result = mockInArray(...args);
      return result;
    },
  };
});

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: mockCreateError,
  getRouterParam: mockGetRouterParam,
  readBody: mockReadBody,
});

const { default: handler } =
  await import("@trips-id-stops-handler/reorder.put");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function buildEvent() {
  return { context: { userId: "user-1" } };
}

describe("PUT /api/trips/[id]/stops/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockReturnValue("trip-1");
    mockLoadOwnedOrThrow.mockResolvedValue({ id: "trip-1" });
    mockReadBody.mockResolvedValue({ stopIds: ["stop-c", "stop-a", "stop-b"] });
    mockSelectWhere.mockResolvedValue([
      { id: "stop-a" },
      { id: "stop-b" },
      { id: "stop-c" },
    ]);
    mockUpdateWhere.mockResolvedValue(undefined);
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
    const REORDERED_STOPS = [
      { id: "stop-c", sortOrder: 0 },
      { id: "stop-a", sortOrder: 1 },
      { id: "stop-b", sortOrder: 2 },
    ];
    mockInArray.mockResolvedValue(REORDERED_STOPS);
    mockFrom.mockReturnValue({ where: mockSelectWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("updates sort order for each stop and returns reordered list", async () => {
    const result = (await callHandler(handler, buildEvent())) as {
      id: string;
      sortOrder: number;
    }[];

    expect(mockUpdate).toHaveBeenCalledTimes(3);
    // Each stop should be updated with its new sortOrder
    expect(mockSet).toHaveBeenCalledWith({ sortOrder: 0 });
    expect(mockSet).toHaveBeenCalledWith({ sortOrder: 1 });
    expect(mockSet).toHaveBeenCalledWith({ sortOrder: 2 });
    // Result should be ordered by the requested stopIds order
    expect(result.map((stop) => stop.id)).toEqual([
      "stop-c",
      "stop-a",
      "stop-b",
    ]);
  });

  it("issues the per-stop updates as one atomic batch instead of separate calls", async () => {
    await callHandler(handler, buildEvent());

    // All 3 updates travel in a single database.batch() call (real
    // BEGIN/COMMIT on the neon-http driver) rather than as independent,
    // non-atomic round trips.
    expect(mockBatch).toHaveBeenCalledTimes(1);
    expect(mockBatch.mock.calls[0][0]).toHaveLength(3);
  });

  it("throws 400 when stopIds is not an array", async () => {
    mockReadBody.mockResolvedValue({ stopIds: "not-an-array" });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when stopIds is empty", async () => {
    mockReadBody.mockResolvedValue({ stopIds: [] });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when stopIds contains duplicates", async () => {
    mockReadBody.mockResolvedValue({ stopIds: ["stop-a", "stop-a", "stop-b"] });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when a stopId does not belong to the trip", async () => {
    mockReadBody.mockResolvedValue({
      stopIds: ["stop-a", "stop-b", "stop-UNKNOWN"],
    });

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when the reorder list is missing stops", async () => {
    // Only provide 2 of 3 existing stops
    mockReadBody.mockResolvedValue({ stopIds: ["stop-a", "stop-b"] });

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

  it("throws 404 when the trip is not owned by the user", async () => {
    mockLoadOwnedOrThrow.mockRejectedValue(makeOwnershipError());

    await expect(callHandler(handler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("rejects when one of the updates fails", async () => {
    mockUpdateWhere.mockRejectedValueOnce(new Error("DB error"));

    await expect(callHandler(handler, buildEvent())).rejects.toThrow(
      "DB error",
    );
  });
});
