import { describe, it, expect, vi, beforeEach } from "vitest";
import { installNitroGlobals, unwrapHandler } from "../follows/_helpers";

installNitroGlobals();

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
  ensureUser: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("../../../server/utils/profile-queries", () => ({
  requireViewableProfile: vi.fn(),
  fetchFollowers: vi.fn(),
}));

import { requireUser } from "../../../server/utils/auth";
import {
  requireViewableProfile,
  fetchFollowers,
} from "../../../server/utils/profile-queries";

const mockRequireUser = vi.mocked(requireUser);
const mockRequireViewableProfile = vi.mocked(requireViewableProfile);
const mockFetchFollowers = vi.mocked(fetchFollowers);

const handler = await import("../../../server/api/users/[id]/followers.get");
const callHandler = () => unwrapHandler(handler as Record<string, unknown>)({});

const FOLLOWERS = [{ userId: "user-2", displayName: "Marco", handle: "marco" }];

describe("GET /api/users/[id]/followers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getRouterParam as ReturnType<typeof vi.fn>).mockReturnValue("target-1");
  });

  it("returns the followers page once the profile passes the visibility guard", async () => {
    mockRequireUser.mockReturnValue("viewer-1");
    mockRequireViewableProfile.mockResolvedValue(
      {} as Awaited<ReturnType<typeof requireViewableProfile>>,
    );
    mockFetchFollowers.mockResolvedValue({
      followers: FOLLOWERS,
      hasMore: true,
    });

    const result = await callHandler();

    expect(result).toEqual({ followers: FOLLOWERS, hasMore: true });
    expect(mockRequireViewableProfile).toHaveBeenCalledWith(
      {},
      "viewer-1",
      "target-1",
    );
    expect(mockFetchFollowers).toHaveBeenCalledWith({}, "target-1");
  });

  it("does not list followers when the visibility guard rejects", async () => {
    mockRequireUser.mockReturnValue("viewer-1");
    mockRequireViewableProfile.mockRejectedValue(
      createError({ statusCode: 404, statusMessage: "Profile not found" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetchFollowers).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireUser.mockImplementation(() => {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    });

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 401 });
  });
});
