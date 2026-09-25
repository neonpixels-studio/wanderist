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

  // #279: a shared profile link must open for an anonymous visitor, so
  // requireViewableProfileTarget resolves with a null viewerId rather than
  // throwing 401 — the visibility guard itself (tested separately in
  // profile-queries.test.ts) decides whether an anonymous viewer may see this
  // profile at all. fetchPublicGuides is the one sub-resource query that
  // branches on the viewer (an owner sees their non-discoverable guides too,
  // see profile-queries.ts), so the null viewerId must reach it unchanged —
  // not get coalesced to targetUserId, which would hand an anonymous visitor
  // the owner's private guides.
  it("forwards a null viewerId to fetchPublicGuides for an anonymous visitor", async () => {
    mockRequireViewableProfileTarget.mockResolvedValue({
      database: {} as Awaited<
        ReturnType<typeof requireViewableProfileTarget>
      >["database"],
      targetUserId: "target-1",
      viewerId: null,
    });
    mockFetchPublicGuides.mockResolvedValue({ guides: GUIDES, hasMore: true });

    const result = await callHandler();

    expect(result).toEqual({ guides: GUIDES, hasMore: true });
    expect(mockFetchPublicGuides).toHaveBeenCalledWith({}, "target-1", null);
  });
});
