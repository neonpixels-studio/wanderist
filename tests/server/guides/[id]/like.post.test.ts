import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../../test-utils";

stubNitroGlobals();

vi.mock("../../../../server/utils/db-helpers", () => ({
  requireRouterParam: vi.fn(),
}));

vi.mock("../../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("../../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../../../server/utils/like-helpers", () => ({
  GUIDE_LIKEABLE: { name: "guide" },
  likeContent: vi.fn(),
}));

vi.mock("../../../../server/utils/guide-queries", () => ({
  loadReadableGuide: vi.fn(),
}));

import { requireRouterParam } from "../../../../server/utils/db-helpers";
import { requireUser } from "../../../../server/utils/auth";
import { getDb } from "../../../../server/db/index";
import {
  GUIDE_LIKEABLE,
  likeContent,
} from "../../../../server/utils/like-helpers";
import { loadReadableGuide } from "../../../../server/utils/guide-queries";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockRequireUser = vi.mocked(requireUser);
const mockGetDb = vi.mocked(getDb);
const mockLoadReadableGuide = vi.mocked(loadReadableGuide);
const mockLikeContent = vi.mocked(likeContent);

const handler = await import("../../../../server/api/guides/[id]/like.post");

function invoke() {
  const defaultHandler = "default" in handler ? handler.default : handler;
  return (defaultHandler as (event: unknown) => unknown)({});
}

describe("POST /api/guides/:id/like", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockReturnValue({} as unknown as ReturnType<typeof getDb>);
  });

  it("records the like cross-user and returns only id, count and like state", async () => {
    const updated = {
      id: "g-1",
      userId: "author-1",
      likeCount: 1,
      body: "secret",
    };
    mockRequireRouterParam.mockReturnValue("g-1");
    mockRequireUser.mockReturnValue("liker-2");
    mockLoadReadableGuide.mockResolvedValue(
      updated as unknown as Awaited<ReturnType<typeof loadReadableGuide>>,
    );
    mockLikeContent.mockResolvedValue(
      updated as unknown as Awaited<ReturnType<typeof likeContent>>,
    );

    const result = await invoke();

    expect(mockLoadReadableGuide).toHaveBeenCalledWith(
      expect.anything(),
      "g-1",
      "liker-2",
    );
    expect(mockLikeContent).toHaveBeenCalledWith(
      expect.anything(),
      GUIDE_LIKEABLE,
      "g-1",
      "liker-2",
    );
    expect(result).toEqual({
      id: "g-1",
      likeCount: 1,
      likedByCurrentUser: true,
    });
  });

  it("throws 404 without recording a like when the guide is not readable (missing, private, or a lapsed/undiscoverable author)", async () => {
    mockRequireRouterParam.mockReturnValue("missing");
    mockRequireUser.mockReturnValue("liker-2");
    mockLoadReadableGuide.mockRejectedValue(
      createError({ statusCode: 404, statusMessage: "Guide not found" }),
    );

    await expect(invoke()).rejects.toMatchObject({ statusCode: 404 });
    expect(mockLikeContent).not.toHaveBeenCalled();
  });

  it("throws 400 when id param is missing", async () => {
    mockRequireRouterParam.mockImplementation(() => {
      throw createError({ statusCode: 400, statusMessage: "id is required" });
    });

    await expect(invoke()).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 401 when not authenticated", async () => {
    mockRequireRouterParam.mockReturnValue("g-1");
    mockRequireUser.mockImplementation(() => {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    });

    await expect(invoke()).rejects.toMatchObject({ statusCode: 401 });
  });
});
