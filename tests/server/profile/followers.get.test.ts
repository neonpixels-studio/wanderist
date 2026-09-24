import { describe, it, expect, vi, beforeEach } from "vitest";
import { installNitroGlobals, unwrapHandler } from "../follows/_helpers";

installNitroGlobals();

vi.mock("../../../server/utils/profile-queries", () => ({
  requireViewableProfileTarget: vi.fn(),
  fetchFollowers: vi.fn(),
}));

import {
  requireViewableProfileTarget,
  fetchFollowers,
} from "../../../server/utils/profile-queries";

const mockRequireViewableProfileTarget = vi.mocked(
  requireViewableProfileTarget,
);
const mockFetchFollowers = vi.mocked(fetchFollowers);

const handler = await import("../../../server/api/users/[id]/followers.get");
const callHandler = () => unwrapHandler(handler as Record<string, unknown>)({});

const FOLLOWERS = [{ userId: "user-2", displayName: "Marco", handle: "marco" }];

describe("GET /api/users/[id]/followers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the followers page once the profile passes the visibility guard", async () => {
    mockRequireViewableProfileTarget.mockResolvedValue({
      database: {} as Awaited<
        ReturnType<typeof requireViewableProfileTarget>
      >["database"],
      targetUserId: "target-1",
      viewerId: "viewer-1",
    });
    mockFetchFollowers.mockResolvedValue({
      followers: FOLLOWERS,
      hasMore: true,
    });

    const result = await callHandler();

    expect(result).toEqual({ followers: FOLLOWERS, hasMore: true });
    expect(mockFetchFollowers).toHaveBeenCalledWith({}, "target-1");
  });

  it("does not list followers when the visibility guard rejects", async () => {
    mockRequireViewableProfileTarget.mockRejectedValue(
      createError({ statusCode: 404, statusMessage: "Profile not found" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetchFollowers).not.toHaveBeenCalled();
  });

  // #279: a shared profile link must open for an anonymous visitor, so
  // requireViewableProfileTarget resolves with a null viewerId rather than
  // throwing 401 — the visibility guard itself (tested separately in
  // profile-queries.test.ts) decides whether an anonymous viewer may see this
  // profile at all.
  it("returns the followers page for an anonymous (null) viewer", async () => {
    mockRequireViewableProfileTarget.mockResolvedValue({
      database: {} as Awaited<
        ReturnType<typeof requireViewableProfileTarget>
      >["database"],
      targetUserId: "target-1",
      viewerId: null,
    });
    mockFetchFollowers.mockResolvedValue({
      followers: FOLLOWERS,
      hasMore: true,
    });

    const result = await callHandler();

    expect(result).toEqual({ followers: FOLLOWERS, hasMore: true });
    expect(mockFetchFollowers).toHaveBeenCalledWith({}, "target-1");
  });
});
