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
  ENTRY_LIKEABLE: { name: "entry" },
  loadLikeableOrThrow: vi.fn(),
  likeContent: vi.fn(),
}));

import { requireRouterParam } from "../../../../server/utils/db-helpers";
import { requireUser } from "../../../../server/utils/auth";
import { getDb } from "../../../../server/db/index";
import {
  ENTRY_LIKEABLE,
  loadLikeableOrThrow,
  likeContent,
} from "../../../../server/utils/like-helpers";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockRequireUser = vi.mocked(requireUser);
const mockGetDb = vi.mocked(getDb);
const mockLoadLikeableOrThrow = vi.mocked(loadLikeableOrThrow);
const mockLikeContent = vi.mocked(likeContent);

const handler = await import("../../../../server/api/entries/[id]/like.post");

function invoke() {
  const defaultHandler = "default" in handler ? handler.default : handler;
  return (defaultHandler as (event: unknown) => unknown)({});
}

describe("POST /api/entries/:id/like", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockReturnValue({} as unknown as ReturnType<typeof getDb>);
  });

  it("records the like cross-user and returns only id, count and like state", async () => {
    const updated = {
      id: "e-1",
      userId: "author-1",
      likeCount: 1,
      body: "secret",
    };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockRequireUser.mockReturnValue("liker-2");
    mockLoadLikeableOrThrow.mockResolvedValue(
      updated as unknown as Awaited<ReturnType<typeof loadLikeableOrThrow>>,
    );
    mockLikeContent.mockResolvedValue(
      updated as unknown as Awaited<ReturnType<typeof likeContent>>,
    );

    const result = await invoke();

    // Pin the config so an entries handler that passed GUIDE_LIKEABLE (writing
    // guide_likes for an entry id) fails rather than slipping through.
    expect(mockLoadLikeableOrThrow).toHaveBeenCalledWith(
      expect.anything(),
      ENTRY_LIKEABLE,
      "e-1",
      "liker-2",
    );
    expect(mockLikeContent).toHaveBeenCalledWith(
      expect.anything(),
      ENTRY_LIKEABLE,
      "e-1",
      "liker-2",
    );
    // The response must not leak the parent row's body to a cross-user liker.
    expect(result).toEqual({
      id: "e-1",
      likeCount: 1,
      likedByCurrentUser: true,
    });
  });

  it("throws 400 when id param is missing", async () => {
    mockRequireRouterParam.mockImplementation(() => {
      throw createError({ statusCode: 400, statusMessage: "id is required" });
    });

    await expect(invoke()).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 404 when the entry is missing or not likeable", async () => {
    mockRequireRouterParam.mockReturnValue("missing");
    mockRequireUser.mockReturnValue("liker-2");
    mockLoadLikeableOrThrow.mockRejectedValue(
      createError({ statusCode: 404, statusMessage: "Not found" }),
    );

    await expect(invoke()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 401 when not authenticated", async () => {
    mockRequireRouterParam.mockReturnValue("e-1");
    mockRequireUser.mockImplementation(() => {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    });

    await expect(invoke()).rejects.toMatchObject({ statusCode: 401 });
  });
});
