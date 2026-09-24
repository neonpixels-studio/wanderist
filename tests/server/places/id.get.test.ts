import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("../../../server/utils/db-helpers", () => ({
  requireRouterParam: vi.fn(),
  loadOwnedOrThrow: vi.fn(),
}));

// Returns a distinguishable value (not an identity passthrough) so the test
// below can tell "the handler returned the gate's output" apart from "the
// handler returned the raw row and happened to call the gate as a side
// effect" — those are different bugs and an identity mock can't tell them
// apart.
vi.mock("../../../server/utils/locationPrivacy", () => ({
  applyPreciseLocationPrivacy: vi.fn((place: Record<string, unknown>) => ({
    ...place,
    __gated: true,
  })),
}));

import {
  requireRouterParam,
  loadOwnedOrThrow,
} from "../../../server/utils/db-helpers";
import { requireUser } from "../../../server/utils/auth";
import { applyPreciseLocationPrivacy } from "../../../server/utils/locationPrivacy";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockLoadOwnedOrThrow = vi.mocked(loadOwnedOrThrow);
const mockRequireUser = vi.mocked(requireUser);
const mockApplyPreciseLocationPrivacy = vi.mocked(applyPreciseLocationPrivacy);

const handler = await import("../../../server/api/places/[id].get");

describe("GET /api/places/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the place when found and owned", async () => {
    const expectedPlace = {
      id: "place-1",
      userId: "user-1",
      name: "Tokyo",
      latitude: 35.6762,
      longitude: 139.6503,
    };
    mockRequireRouterParam.mockReturnValue("place-1");
    mockLoadOwnedOrThrow.mockResolvedValue(
      expectedPlace as unknown as Awaited<ReturnType<typeof loadOwnedOrThrow>>,
    );
    mockRequireUser.mockReturnValue("user-1");

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    // Pins the wiring both ways: the handler must call the privacy gate with
    // the loaded row and resolved viewer id, AND must return the gate's
    // output (the `__gated` marker) rather than discarding it and returning
    // the raw loaded row.
    expect(result).toEqual({ ...expectedPlace, __gated: true });
    expect(mockLoadOwnedOrThrow).toHaveBeenCalledTimes(1);
    expect(mockApplyPreciseLocationPrivacy).toHaveBeenCalledWith(
      expectedPlace,
      "user-1",
    );
  });

  it("throws 400 when id param is missing", async () => {
    const missingError = createError({
      statusCode: 400,
      statusMessage: "id is required",
    });
    mockRequireRouterParam.mockImplementation(() => {
      throw missingError;
    });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 404 when place is not found or not owned", async () => {
    mockRequireRouterParam.mockReturnValue("place-missing");
    const notFoundError = createError({
      statusCode: 404,
      statusMessage: "Not found",
    });
    mockLoadOwnedOrThrow.mockRejectedValue(notFoundError);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 401 when not authenticated", async () => {
    mockRequireRouterParam.mockReturnValue("place-1");
    const unauthorizedError = createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
    mockLoadOwnedOrThrow.mockRejectedValue(unauthorizedError);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
