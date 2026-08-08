import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";
import {
  assertThrows404WhenNotOwned,
  assertThrows401WhenUnauthenticated,
} from "./_helpers";

stubNitroGlobals();

vi.mock("../../../server/utils/db-helpers", () => ({
  requireRouterParam: vi.fn(),
  loadOwnedOrThrow: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../../server/utils/coverImageCleanup", () => ({
  deleteMediaIfUnreferenced: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original, eq: vi.fn(original.eq) };
});

import { eq } from "drizzle-orm";
import {
  requireRouterParam,
  loadOwnedOrThrow,
} from "../../../server/utils/db-helpers";
import { getDb } from "../../../server/db/index";
import { deleteMediaIfUnreferenced } from "../../../server/utils/coverImageCleanup";
import { entries, entryPhotos } from "../../../server/db/schema";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockLoadOwnedOrThrow = vi.mocked(loadOwnedOrThrow);
const mockGetDb = vi.mocked(getDb);
const mockDeleteMediaIfUnreferenced = vi.mocked(deleteMediaIfUnreferenced);

const handler = await import("../../../server/api/entries/[id].delete");

// Db mock covering the select(photos) -> from -> where chain used to collect
// the entry's media ids, plus the delete(entries) -> where chain.
function makeDb(photoRows: { mediaId: string }[]) {
  const selectWhereMock = vi.fn().mockResolvedValue(photoRows);
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const selectMock = vi.fn().mockReturnValue({ from: selectFromMock });

  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn().mockReturnValue({ where: deleteWhereMock });

  return {
    select: selectMock,
    selectFromMock,
    delete: deleteMock,
    deleteWhereMock,
  };
}

function invokeHandler(event: unknown): Promise<unknown> {
  const invoke = handler.default as (event: unknown) => Promise<unknown>;
  return invoke(event);
}

describe("DELETE /api/entries/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRouterParam.mockReturnValue("e-1");
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "e-1",
      userId: "user-1",
    } as never);
    mockDeleteMediaIfUnreferenced.mockResolvedValue(true);
  });

  it("deletes the entry and returns success", async () => {
    const mockDb = makeDb([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const result = await invokeHandler({});

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
  });

  it("verifies ownership before deleting", async () => {
    const mockDb = makeDb([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockLoadOwnedOrThrow).toHaveBeenCalledWith(
      {},
      entries,
      entries.id,
      entries.userId,
      "e-1",
    );

    const ownershipOrder = mockLoadOwnedOrThrow.mock.invocationCallOrder[0];
    const deleteOrder = mockDb.delete.mock.invocationCallOrder[0];
    expect(ownershipOrder).toBeLessThan(deleteOrder);
  });

  it("scopes the photo lookup to this entry's photos", async () => {
    const mockDb = makeDb([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockDb.selectFromMock).toHaveBeenCalledWith(entryPhotos);
    expect(eq).toHaveBeenCalledWith(entryPhotos.entryId, "e-1");
  });

  it("scopes the delete to this entry", async () => {
    const mockDb = makeDb([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockDb.delete).toHaveBeenCalledWith(entries);
    expect(eq).toHaveBeenCalledWith(entries.id, "e-1");
  });

  it("cleans up each distinct photo media the entry referenced", async () => {
    const mockDb = makeDb([
      { mediaId: "media-1" },
      { mediaId: "media-2" },
      { mediaId: "media-1" },
    ]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledTimes(2);
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "media-1",
    );
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "media-2",
    );
  });

  it("does not clean up media when the entry has no photos", async () => {
    const mockDb = makeDb([]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("collects the photo media ids before deleting the entry", async () => {
    const mockDb = makeDb([{ mediaId: "media-1" }]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    const selectOrder = mockDb.select.mock.invocationCallOrder[0];
    const deleteOrder = mockDb.delete.mock.invocationCallOrder[0];
    expect(selectOrder).toBeLessThan(deleteOrder);
  });

  it("deletes the entry before cleaning up its photo media", async () => {
    const mockDb = makeDb([{ mediaId: "media-1" }]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    const deleteOrder = mockDb.delete.mock.invocationCallOrder[0];
    const cleanupOrder =
      mockDeleteMediaIfUnreferenced.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(cleanupOrder);
  });

  it("does not delete the entry when the photo lookup throws", async () => {
    const mockDb = makeDb([]);
    mockDb.selectFromMock.mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error("db down")),
    });
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await expect(invokeHandler({})).rejects.toThrow("db down");
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("does not clean up media when the entry delete throws", async () => {
    const mockDb = makeDb([{ mediaId: "media-1" }]);
    mockDb.deleteWhereMock.mockRejectedValue(new Error("db down"));
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await expect(invokeHandler({})).rejects.toThrow("db down");
    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("still returns success and logs when photo media cleanup fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const mockDb = makeDb([{ mediaId: "media-1" }]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    mockDeleteMediaIfUnreferenced.mockRejectedValue(new Error("blob down"));

    const result = await invokeHandler({});

    expect(result).toEqual({ success: true });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("cleans up remaining photo media when one cleanup fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const mockDb = makeDb([{ mediaId: "media-1" }, { mediaId: "media-2" }]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    mockDeleteMediaIfUnreferenced.mockImplementation(
      async (_database: unknown, _ownerId: unknown, mediaId: unknown) => {
        if (mediaId === "media-1") {
          throw new Error("blob down");
        }
        return true;
      },
    );

    const result = await invokeHandler({});

    expect(result).toEqual({ success: true });
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "media-2",
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "1 of 2 photo media cleanups failed for entry e-1",
      ),
    );
    consoleError.mockRestore();
  });

  it("throws 400 when id param is missing", async () => {
    const missingError = createError({
      statusCode: 400,
      statusMessage: "id is required",
    });
    mockRequireRouterParam.mockImplementation(() => {
      throw missingError;
    });

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 404 when entry is not owned", async () => {
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
