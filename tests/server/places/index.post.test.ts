import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

const mockReadBody = vi.fn();
vi.stubGlobal("readBody", mockReadBody);

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
  ensureUser: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

const mockAssertPlaceLimit = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../server/utils/planLimits", () => ({
  assertPlaceLimit: mockAssertPlaceLimit,
}));

// Returns a distinguishable value (not an identity passthrough) so tests can
// tell "the handler returned the gate's output" apart from "the handler
// returned the raw row and happened to call the gate as a side effect."
vi.mock("../../../server/utils/locationPrivacy", () => ({
  applyPreciseLocationPrivacy: vi.fn((place: Record<string, unknown>) => ({
    ...place,
    __gated: true,
  })),
}));

import { ensureUser } from "../../../server/utils/auth";
import { getDb } from "../../../server/db/index";
import { applyPreciseLocationPrivacy } from "../../../server/utils/locationPrivacy";

const mockEnsureUser = vi.mocked(ensureUser);
const mockGetDb = vi.mocked(getDb);
const mockApplyPreciseLocationPrivacy = vi.mocked(applyPreciseLocationPrivacy);

function makeDbWithInsert(returned: Record<string, unknown>) {
  const returningMock = vi.fn().mockResolvedValue([returned]);
  const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  return { insert: insertMock };
}

const handler = await import("../../../server/api/places/index.post");

describe("POST /api/places", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertPlaceLimit.mockResolvedValue(undefined);
  });

  it("propagates a 402 when the plan's place limit has been reached", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockAssertPlaceLimit.mockRejectedValue(
      Object.assign(new Error("Plan limit reached"), { statusCode: 402 }),
    );

    await expect(
      (handler.default as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 402 });
    expect(mockAssertPlaceLimit).toHaveBeenCalledWith("user-1");
  });

  it("creates a place and returns it", async () => {
    const createdPlace = {
      id: "uuid-1",
      userId: "user-1",
      name: "Paris",
      subtitle: "France",
      country: "France",
      category: "city",
      latitude: 48.8566,
      longitude: 2.3522,
    };
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({
      name: "Paris",
      subtitle: "France",
      country: "France",
      category: "city",
      latitude: 48.8566,
      longitude: 2.3522,
    });
    const mockDb = makeDbWithInsert(createdPlace);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    // Pins the wiring both ways: the handler must call the privacy gate with
    // the newly-created row and resolved caller id, AND must return the
    // gate's output (the `__gated` marker) rather than the raw insert result.
    expect(result).toEqual({ ...createdPlace, __gated: true });
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockApplyPreciseLocationPrivacy).toHaveBeenCalledWith(
      createdPlace,
      "user-1",
    );
  });

  it("throws 500 when the insert returns no row", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ name: "Paris" });

    const returningMock = vi.fn().mockResolvedValue([]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    const mockDb = { insert: vi.fn().mockReturnValue({ values: valuesMock }) };
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("throws 400 when name is missing", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ subtitle: "France" });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when name is empty", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ name: "   " });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when latitude is not a number", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ name: "Paris", latitude: "not-a-number" });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates a place without optional fields", async () => {
    const createdPlace = {
      id: "uuid-2",
      userId: "user-1",
      name: "Unnamed",
      subtitle: null,
      country: null,
      category: null,
      latitude: null,
      longitude: null,
    };
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ name: "Unnamed" });
    const mockDb = makeDbWithInsert(createdPlace);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(result).toEqual({ ...createdPlace, __gated: true });
  });

  it("throws 400 when only latitude is provided without longitude", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ name: "Paris", latitude: 48.8566 });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when only longitude is provided without latitude", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ name: "Paris", longitude: 2.3522 });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 401 when not authenticated", async () => {
    const unauthorizedError = createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
    mockEnsureUser.mockRejectedValue(unauthorizedError);
    mockReadBody.mockResolvedValue({ name: "Paris" });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
