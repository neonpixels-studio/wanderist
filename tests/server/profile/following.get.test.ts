import { describe, it, expect, vi, beforeEach } from "vitest";
import { installNitroGlobals, unwrapHandler } from "../follows/_helpers";

installNitroGlobals();

vi.mock("../../../server/utils/profile-queries", () => ({
  requireViewableProfileTarget: vi.fn(),
  fetchFollowing: vi.fn(),
}));

import {
  requireViewableProfileTarget,
  fetchFollowing,
} from "../../../server/utils/profile-queries";

const mockRequireViewableProfileTarget = vi.mocked(
  requireViewableProfileTarget,
);
const mockFetchFollowing = vi.mocked(fetchFollowing);

const handler = await import("../../../server/api/users/[id]/following.get");
const callHandler = () => unwrapHandler(handler as Record<string, unknown>)({});

const FOLLOWING = [{ userId: "user-2", displayName: "Marco", handle: "marco" }];

describe("GET /api/users/[id]/following", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the following page once the profile passes the visibility guard", async () => {
    mockRequireViewableProfileTarget.mockResolvedValue({
      database: {} as Awaited<
        ReturnType<typeof requireViewableProfileTarget>
      >["database"],
      targetUserId: "target-1",
      viewerId: "viewer-1",
    });
    mockFetchFollowing.mockResolvedValue({
      following: FOLLOWING,
      hasMore: true,
    });

    const result = await callHandler();

    expect(result).toEqual({ following: FOLLOWING, hasMore: true });
    expect(mockFetchFollowing).toHaveBeenCalledWith({}, "target-1");
  });

  it("does not list following when the visibility guard rejects", async () => {
    mockRequireViewableProfileTarget.mockRejectedValue(
      createError({ statusCode: 404, statusMessage: "Profile not found" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetchFollowing).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireViewableProfileTarget.mockRejectedValue(
      createError({ statusCode: 401, statusMessage: "Unauthorized" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 401 });
  });
});
