import { describe, it, expect, vi, beforeEach } from "vitest";
import { installNitroGlobals, unwrapHandler } from "../follows/_helpers";

installNitroGlobals();

vi.mock("../../../server/utils/profile-queries", () => ({
  requireViewableProfileTarget: vi.fn(),
  fetchPublicGuides: vi.fn(),
}));

import {
  requireViewableProfileTarget,
  fetchPublicGuides,
} from "../../../server/utils/profile-queries";

const mockRequireViewableProfileTarget = vi.mocked(
  requireViewableProfileTarget,
);
const mockFetchPublicGuides = vi.mocked(fetchPublicGuides);

const handler = await import("../../../server/api/users/[id]/guides.get");
const callHandler = () => unwrapHandler(handler as Record<string, unknown>)({});

const GUIDES = [
  { id: "guide-1", title: "Tokyo on foot", readTimeMinutes: 8, likeCount: 3 },
];

describe("GET /api/users/[id]/guides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the public guides page once the profile passes the visibility guard", async () => {
    mockRequireViewableProfileTarget.mockResolvedValue({
      database: {} as Awaited<
        ReturnType<typeof requireViewableProfileTarget>
      >["database"],
      targetUserId: "target-1",
      viewerId: "viewer-1",
    });
    mockFetchPublicGuides.mockResolvedValue({ guides: GUIDES, hasMore: true });

    const result = await callHandler();

    expect(result).toEqual({ guides: GUIDES, hasMore: true });
    // The viewer id must be forwarded: fetchPublicGuides relies on it to tell
    // an owner viewing their own guides apart from anyone else.
    expect(mockFetchPublicGuides).toHaveBeenCalledWith(
      {},
      "target-1",
      "viewer-1",
    );
  });

  it("does not list guides when the visibility guard rejects", async () => {
    mockRequireViewableProfileTarget.mockRejectedValue(
      createError({ statusCode: 404, statusMessage: "Profile not found" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetchPublicGuides).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireViewableProfileTarget.mockRejectedValue(
      createError({ statusCode: 401, statusMessage: "Unauthorized" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 401 });
  });
});
