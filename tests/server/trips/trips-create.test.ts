/**
 * Tests for POST /api/trips — create a trip
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockEnsureUser,
  mockReadBody,
  mockInsert,
  mockValues,
  mockReturning,
  mockCreateError,
} = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([
    {
      id: "new-id",
      userId: "user-1",
      name: "Test Trip",
      status: "upcoming",
      visibility: "private",
      startDate: null,
      endDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  const mockEnsureUser = vi.fn().mockResolvedValue("user-1");
  const mockReadBody = vi.fn().mockResolvedValue({ name: "Test Trip" });

  const mockCreateError = vi.fn(
    (options: { statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(options.statusMessage), options),
  );

  return {
    mockEnsureUser,
    mockReadBody,
    mockInsert,
    mockValues,
    mockReturning,
    mockCreateError,
  };
});

vi.mock("../../../server/utils/auth", () => ({
  ensureUser: mockEnsureUser,
}));

vi.mock("../../../server/utils/db-helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../server/utils/db-helpers")>();
  return {
    ...actual,
  };
});

vi.mock("../../../server/db/index", () => ({
  getDb: () => ({ insert: mockInsert }),
}));

const mockAssertActiveTripLimit = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../server/utils/planLimits", () => ({
  assertActiveTripLimit: mockAssertActiveTripLimit,
}));

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: mockCreateError,
  readBody: mockReadBody,
});

// Stub randomUUID without overwriting the read-only crypto global
vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
  "new-id" as ReturnType<typeof crypto.randomUUID>,
);

const { default: handler } =
  await import("../../../server/api/trips/index.post");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function buildEvent() {
  return { context: { userId: "user-1" } };
}

describe("POST /api/trips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "new-id" as ReturnType<typeof crypto.randomUUID>,
    );
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ name: "Test Trip" });
    mockReturning.mockResolvedValue([
      {
        id: "new-id",
        userId: "user-1",
        name: "Test Trip",
        status: "upcoming",
        visibility: "private",
        startDate: null,
        endDate: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });
    mockAssertActiveTripLimit.mockResolvedValue(undefined);
  });

  it("propagates a 402 when the plan's active-trip limit has been reached", async () => {
    mockAssertActiveTripLimit.mockRejectedValue(
      Object.assign(new Error("Plan limit reached"), { statusCode: 402 }),
    );

    await expect(
      (handler as (event: object) => Promise<unknown>)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 402 });
    expect(mockAssertActiveTripLimit).toHaveBeenCalledWith("user-1");
  });

  it("does not check the active-trip limit when creating a 'past' trip", async () => {
    mockReadBody.mockResolvedValue({ name: "Old Trip", status: "past" });
    mockReturning.mockResolvedValue([
      {
        id: "new-id",
        userId: "user-1",
        name: "Old Trip",
        status: "past",
        visibility: "private",
        startDate: null,
        endDate: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    await (handler as (event: object) => Promise<unknown>)(buildEvent());

    expect(mockAssertActiveTripLimit).not.toHaveBeenCalled();
  });

  it("does not check the active-trip limit when endDate has already elapsed, even with the default 'upcoming' status", async () => {
    mockReadBody.mockResolvedValue({
      name: "Old Trip",
      endDate: "2000-01-01T00:00:00.000Z",
    });
    mockReturning.mockResolvedValue([
      {
        id: "new-id",
        userId: "user-1",
        name: "Old Trip",
        status: "past",
        visibility: "private",
        startDate: null,
        endDate: new Date("2000-01-01T00:00:00.000Z"),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    await (handler as (event: object) => Promise<unknown>)(buildEvent());

    expect(mockAssertActiveTripLimit).not.toHaveBeenCalled();
  });

  it("normalizes the stored status to 'past' when the requested status disagrees with an already-elapsed endDate", async () => {
    // Otherwise the trip would render as "ongoing" in the UI (which reads
    // the stored status directly) while never having counted against the
    // active-trip limit — the two would silently disagree.
    mockReadBody.mockResolvedValue({
      name: "Old Trip",
      status: "ongoing",
      endDate: "2000-01-01T00:00:00.000Z",
    });

    await (handler as (event: object) => Promise<unknown>)(buildEvent());

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "past" }),
    );
  });

  it("creates and returns a trip with minimal required fields", async () => {
    const result = await (handler as (event: object) => Promise<unknown>)(
      buildEvent(),
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test Trip",
        userId: "user-1",
        status: "upcoming",
        visibility: "private",
      }),
    );
    expect(result).toMatchObject({ name: "Test Trip", userId: "user-1" });
  });

  it("accepts custom status and visibility", async () => {
    mockReadBody.mockResolvedValue({
      name: "Active Trip",
      status: "ongoing",
      visibility: "public",
    });
    mockReturning.mockResolvedValue([
      {
        id: "new-id",
        userId: "user-1",
        name: "Active Trip",
        status: "ongoing",
        visibility: "public",
        startDate: null,
        endDate: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    await (handler as (event: object) => Promise<unknown>)(buildEvent());

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ongoing", visibility: "public" }),
    );
  });

  it("accepts startDate and endDate as ISO strings", async () => {
    mockReadBody.mockResolvedValue({
      name: "Dated Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-10T00:00:00.000Z",
    });
    mockReturning.mockResolvedValue([
      {
        id: "new-id",
        userId: "user-1",
        name: "Dated Trip",
        status: "upcoming",
        visibility: "private",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-10T00:00:00.000Z"),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    await (handler as (event: object) => Promise<unknown>)(buildEvent());

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: expect.any(Date),
        endDate: expect.any(Date),
      }),
    );
  });

  it("throws 400 when name is missing", async () => {
    mockReadBody.mockResolvedValue({});

    await expect(
      (handler as (event: object) => Promise<unknown>)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when name is empty string", async () => {
    mockReadBody.mockResolvedValue({ name: "" });

    await expect(
      (handler as (event: object) => Promise<unknown>)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 for an invalid status value", async () => {
    mockReadBody.mockResolvedValue({ name: "Trip", status: "invalid" });

    await expect(
      (handler as (event: object) => Promise<unknown>)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 for an invalid visibility value", async () => {
    mockReadBody.mockResolvedValue({
      name: "Trip",
      visibility: "friends-only",
    });

    await expect(
      (handler as (event: object) => Promise<unknown>)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when startDate is not a valid date string", async () => {
    mockReadBody.mockResolvedValue({ name: "Trip", startDate: "not-a-date" });

    await expect(
      (handler as (event: object) => Promise<unknown>)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when endDate is before startDate", async () => {
    mockReadBody.mockResolvedValue({
      name: "Trip",
      startDate: "2026-07-10T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    await expect(
      (handler as (event: object) => Promise<unknown>)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 401 when not authenticated", async () => {
    mockEnsureUser.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
    );

    await expect(
      (handler as (event: object) => Promise<unknown>)(buildEvent()),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
