import { describe, it, expect, vi, beforeEach } from "vitest";
import { installNitroGlobals, makeDeleteChain } from "./_helpers";

installNitroGlobals();

vi.mock("../../../server/utils/db-helpers", () => ({
  requireRouterParam: vi.fn(),
  assertOwnership: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

import {
  requireRouterParam,
  assertOwnership,
} from "../../../server/utils/db-helpers";
import { getDb } from "../../../server/db/index";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockAssertOwnership = vi.mocked(assertOwnership);
const mockGetDb = vi.mocked(getDb);

const handler = await import("../../../server/api/notifications/[id].delete");
const defaultHandler = "default" in handler ? handler.default : handler;
const callHandler = () => (defaultHandler as (event: unknown) => unknown)({});

describe("DELETE /api/notifications/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the owned notification and returns success:true", async () => {
    mockRequireRouterParam.mockReturnValue("notif-1");
    mockAssertOwnership.mockResolvedValue(undefined);

    const deleteChain = makeDeleteChain();
    mockGetDb.mockReturnValue(
      deleteChain as unknown as ReturnType<typeof getDb>,
    );

    const result = await callHandler();

    expect(result).toEqual({ success: true });
    expect(deleteChain.delete).toHaveBeenCalledTimes(1);
  });

  it("calls assertOwnership before deleting", async () => {
    mockRequireRouterParam.mockReturnValue("notif-1");
    mockAssertOwnership.mockResolvedValue(undefined);

    const deleteChain = makeDeleteChain();
    mockGetDb.mockReturnValue(
      deleteChain as unknown as ReturnType<typeof getDb>,
    );

    await callHandler();

    expect(mockAssertOwnership).toHaveBeenCalledTimes(1);
    expect(deleteChain.delete).toHaveBeenCalledTimes(1);
  });

  it("throws 400 when id param is missing", async () => {
    const missingError = createError({
      statusCode: 400,
      statusMessage: "id is required",
    });
    mockRequireRouterParam.mockImplementation(() => {
      throw missingError;
    });

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireRouterParam.mockReturnValue("notif-1");
    mockAssertOwnership.mockImplementation(() => {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    });

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 404 when the notification is not owned by the user", async () => {
    mockRequireRouterParam.mockReturnValue("notif-1");
    mockAssertOwnership.mockImplementation(() => {
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    });

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 404 });
  });
});
