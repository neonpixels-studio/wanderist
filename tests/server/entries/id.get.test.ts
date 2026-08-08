import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";
import {
  assertThrows404WhenNotOwned,
  assertThrows401WhenUnauthenticated,
} from "./_helpers";

stubNitroGlobals();

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("../../../server/utils/db-helpers", () => ({
  requireRouterParam: vi.fn(),
  loadOwnedOrThrow: vi.fn(),
}));

vi.mock("../../../server/utils/entry-helpers", () => ({
  loadEntryRelations: vi.fn().mockResolvedValue({ photos: [], tags: [] }),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../../server/utils/like-helpers", () => ({
  ENTRY_LIKEABLE: { name: "entry" },
  hasLiked: vi.fn().mockResolvedValue(false),
}));

import {
  requireRouterParam,
  loadOwnedOrThrow,
} from "../../../server/utils/db-helpers";
import { requireUser } from "../../../server/utils/auth";
import { loadEntryRelations } from "../../../server/utils/entry-helpers";
import { hasLiked } from "../../../server/utils/like-helpers";
import { getDb } from "../../../server/db/index";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockRequireUser = vi.mocked(requireUser);
const mockLoadOwnedOrThrow = vi.mocked(loadOwnedOrThrow);
const mockLoadEntryRelations = vi.mocked(loadEntryRelations);
const mockHasLiked = vi.mocked(hasLiked);
const mockGetDb = vi.mocked(getDb);

const handler = await import("../../../server/api/entries/[id].get");

describe("GET /api/entries/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadEntryRelations.mockResolvedValue({ photos: [], tags: [] });
    mockHasLiked.mockResolvedValue(false);
  });

  it("returns the entry with photos, tags and like state when found and owned", async () => {
    const baseEntry = { id: "e-1", userId: "user-1", title: "My Entry" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockRequireUser.mockReturnValue("user-1");
    mockLoadOwnedOrThrow.mockResolvedValue(
      baseEntry as unknown as Awaited<ReturnType<typeof loadOwnedOrThrow>>,
    );
    mockHasLiked.mockResolvedValue(true);
    mockGetDb.mockReturnValue({} as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(result).toMatchObject({
      ...baseEntry,
      photos: [],
      tags: [],
      likedByCurrentUser: true,
    });
    expect(mockLoadOwnedOrThrow).toHaveBeenCalledTimes(1);
    expect(mockLoadEntryRelations).toHaveBeenCalledWith(
      expect.anything(),
      "e-1",
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

  it("throws 404 when entry is not found or not owned", async () => {
    await assertThrows404WhenNotOwned(
      mockRequireRouterParam,
      mockLoadOwnedOrThrow,
      handler,
    );
  });

  it("throws 401 when not authenticated", async () => {
    await assertThrows401WhenUnauthenticated(
      mockRequireRouterParam,
      mockLoadOwnedOrThrow,
      handler,
    );
  });
});
