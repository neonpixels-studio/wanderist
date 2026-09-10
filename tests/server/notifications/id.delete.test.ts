import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  installNitroGlobals,
  makeDeleteChain,
  describeEqCondition,
} from "./_helpers";

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
import { notifications } from "../../../server/db/schema";

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
    expect(deleteChain.delete).toHaveBeenCalledWith(notifications);
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
    // Not just "where was called" — a handler that filtered on the wrong
    // column (e.g. userId instead of id) would still pass every assertion
    // above and delete the wrong row(s). eq() is real here (not mocked), so
    // this decodes the actual condition passed to .where().
    expect(describeEqCondition(deleteChain.where.mock.calls[0][0])).toEqual([
      "notifications.id",
      'literal:"notif-1"',
    ]);
  });

  it("checks ownership scoped to the route id before issuing the delete", async () => {
    mockRequireRouterParam.mockReturnValue("notif-1");
    mockAssertOwnership.mockResolvedValue(undefined);

    const deleteChain = makeDeleteChain();
    mockGetDb.mockReturnValue(
      deleteChain as unknown as ReturnType<typeof getDb>,
    );

    await callHandler();

    expect(mockAssertOwnership).toHaveBeenCalledTimes(1);
    expect(mockAssertOwnership).toHaveBeenCalledWith(
      expect.anything(),
      notifications,
      notifications.id,
      notifications.userId,
      "notif-1",
    );
    // Not just "both were called" — assertOwnership's resolution must
    // actually precede the delete, since that ordering is the entire
    // ownership guarantee this endpoint exists to enforce.
    expect(mockAssertOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      deleteChain.delete.mock.invocationCallOrder[0],
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

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 400 });
    expect(mockAssertOwnership).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("throws 401 and never issues the delete when the user is not authenticated", async () => {
    mockRequireRouterParam.mockReturnValue("notif-1");
    mockAssertOwnership.mockImplementation(() => {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    });

    const deleteChain = makeDeleteChain();
    mockGetDb.mockReturnValue(
      deleteChain as unknown as ReturnType<typeof getDb>,
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 401 });
    expect(deleteChain.delete).not.toHaveBeenCalled();
  });

  it("throws 404 and never issues the delete when the notification is not owned by the user", async () => {
    mockRequireRouterParam.mockReturnValue("notif-1");
    mockAssertOwnership.mockImplementation(() => {
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    });

    const deleteChain = makeDeleteChain();
    mockGetDb.mockReturnValue(
      deleteChain as unknown as ReturnType<typeof getDb>,
    );

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 404 });
    expect(deleteChain.delete).not.toHaveBeenCalled();
  });
});
