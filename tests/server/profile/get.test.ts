import { describe, it, expect, vi, beforeEach } from "vitest";
import { installNitroGlobals, unwrapHandler } from "../follows/_helpers";

installNitroGlobals();

vi.mock("../../../server/utils/auth", () => ({
  optionalUser: vi.fn(),
  ensureUser: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("../../../server/utils/profile-queries", () => ({
  requireViewableProfile: vi.fn(),
}));

import { optionalUser } from "../../../server/utils/auth";
import { requireViewableProfile } from "../../../server/utils/profile-queries";

const mockOptionalUser = vi.mocked(optionalUser);
const mockRequireViewableProfile = vi.mocked(requireViewableProfile);

const handler = await import("../../../server/api/users/[id].get");
const callHandler = () => unwrapHandler(handler as Record<string, unknown>)({});

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: "target-1",
    displayName: "Elsa",
    handle: "elsa_far",
    homeBase: "Reykjavik",
    bio: null,
    publicProfile: true,
    effectivelyPublic: true,
    followerCount: 3,
    followingCount: 2,
    placeCount: 9,
    ...overrides,
  };
}

describe("GET /api/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getRouterParam as ReturnType<typeof vi.fn>).mockReturnValue("target-1");
  });

  it("returns the viewable profile marked not-self for another viewer", async () => {
    mockOptionalUser.mockReturnValue("viewer-1");
    mockRequireViewableProfile.mockResolvedValue(profileRow());

    const result = await callHandler();

    expect(result).toMatchObject({ userId: "target-1", isSelf: false });
    expect(mockRequireViewableProfile).toHaveBeenCalledWith(
      {},
      "viewer-1",
      "target-1",
    );
  });

  it("marks the profile as self when the viewer owns it", async () => {
    mockOptionalUser.mockReturnValue("target-1");
    mockRequireViewableProfile.mockResolvedValue(
      profileRow({ publicProfile: false, effectivelyPublic: false }),
    );

    const result = await callHandler();

    expect(result).toMatchObject({ isSelf: true });
  });

  it("propagates the 404 raised by the visibility guard", async () => {
    mockOptionalUser.mockReturnValue("viewer-1");
    mockRequireViewableProfile.mockRejectedValue(
      createError({ statusCode: 404, statusMessage: "Profile not found" }),
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 404 });
  });

  // #279: a shared profile link must open for an anonymous visitor so its
  // og/twitter meta can unfurl — optionalUser returns null rather than
  // throwing, and requireViewableProfile (unit-tested separately in
  // profile-queries.test.ts) treats a null viewer as a non-owner.
  it("returns the viewable profile marked not-self for an anonymous (null) viewer", async () => {
    mockOptionalUser.mockReturnValue(null);
    mockRequireViewableProfile.mockResolvedValue(profileRow());

    const result = await callHandler();

    expect(result).toMatchObject({ userId: "target-1", isSelf: false });
    expect(mockRequireViewableProfile).toHaveBeenCalledWith(
      {},
      null,
      "target-1",
    );
  });
});
