import { describe, it, expect, vi, beforeEach } from "vitest";
import { installNitroGlobals, unwrapHandler } from "../follows/_helpers";

installNitroGlobals();

vi.mock("../../../server/utils/profile-queries", () => ({
  requireViewableProfileTarget: vi.fn(),
  fetchPublicTrips: vi.fn(),
}));

import {
  requireViewableProfileTarget,
  fetchPublicTrips,
} from "../../../server/utils/profile-queries";

const mockRequireViewableProfileTarget = vi.mocked(
  requireViewableProfileTarget,
);
const mockFetchPublicTrips = vi.mocked(fetchPublicTrips);

const handler = await import("../../../server/api/users/[id]/trips.get");
const callHandler = () => unwrapHandler(handler as Record<string, unknown>)({});

const TRIPS = [
  {
    id: "trip-1",
    name: "Iceland Ring Road",
    status: "past",
    startDate: null,
    endDate: null,
    distanceKm: null,
    stopCount: 4,
  },
];

describe("GET /api/users/[id]/trips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the public trips page once the profile passes the visibility guard", async () => {
    mockRequireViewableProfileTarget.mockResolvedValue({
      database: {} as Awaited<
        ReturnType<typeof requireViewableProfileTarget>
      >["database"],
      targetUserId: "target-1",
    });
    mockFetchPublicTrips.mockResolvedValue({ trips: TRIPS, hasMore: true });

    const result = await callHandler();

    expect(result).toEqual({ trips: TRIPS, hasMore: true });
    expect(mockFetchPublicTrips).toHaveBeenCalledWith({}, "target-1");
  });

  it("does not list trips when the visibility guard rejects", async () => {
    mockRequireViewableProfileTarget.mockRejectedValue(
      createError({ statusCode: 404, statusMessage: "Profile not found" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetchPublicTrips).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireViewableProfileTarget.mockRejectedValue(
      createError({ statusCode: 401, statusMessage: "Unauthorized" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 401 });
  });
});
