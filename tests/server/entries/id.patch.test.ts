import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";
import {
  assertThrows404WhenNotOwned,
  assertThrows401WhenUnauthenticated,
} from "./_helpers";

stubNitroGlobals();

const mockReadBody = vi.fn();
vi.stubGlobal("readBody", mockReadBody);

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("../../../server/utils/db-helpers", () => ({
  requireRouterParam: vi.fn(),
  loadOwnedOrThrow: vi.fn(),
  optionalString: vi.fn((value: unknown, _field: string) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "string") {
      const error = new Error("must be a string") as Error & {
        statusCode: number;
        statusMessage: string;
      };
      error.statusCode = 400;
      error.statusMessage = "must be a string";
      throw error;
    }
    return value;
  }),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../../server/utils/coverImageCleanup", () => ({
  deleteMediaIfUnreferenced: vi.fn(),
}));

vi.mock("../../../server/utils/entry-helpers", () => ({
  generateId: vi.fn().mockReturnValue("generated-id"),
  parseOccurredAt: vi.fn((value: unknown) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    const date = new Date(value as string);
    if (isNaN(date.getTime())) {
      const error = new Error("bad date") as Error & {
        statusCode: number;
        statusMessage: string;
      };
      error.statusCode = 400;
      error.statusMessage = "occurredAt must be a valid date string";
      throw error;
    }
    return date;
  }),
  parseStringArray: vi.fn((value: unknown, fieldName: string) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (!Array.isArray(value)) {
      const error = new Error("not array") as Error & {
        statusCode: number;
        statusMessage: string;
      };
      error.statusCode = 400;
      error.statusMessage = `${fieldName} must be an array when provided`;
      throw error;
    }
    return value as string[];
  }),
  upsertTags: vi.fn().mockResolvedValue([]),
  loadEntryRelations: vi.fn().mockResolvedValue({ photos: [], tags: [] }),
  VALID_VISIBILITY: ["private", "public"],
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original, eq: vi.fn(original.eq) };
});

import {
  requireRouterParam,
  loadOwnedOrThrow,
} from "../../../server/utils/db-helpers";
import { getDb } from "../../../server/db/index";
import { deleteMediaIfUnreferenced } from "../../../server/utils/coverImageCleanup";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockLoadOwnedOrThrow = vi.mocked(loadOwnedOrThrow);
const mockGetDb = vi.mocked(getDb);
const mockDeleteMediaIfUnreferenced = vi.mocked(deleteMediaIfUnreferenced);

function makeDbForPatch(updatedEntry: Record<string, unknown>) {
  const returningMock = vi.fn().mockResolvedValue([updatedEntry]);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: whereMock });

  const selectWhereMock = vi.fn().mockResolvedValue([updatedEntry]);
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });

  const txClient = {
    update: vi.fn().mockReturnValue({ set: setMock }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    select: vi.fn().mockReturnValue({ from: selectFromMock }),
  };

  return {
    transaction: vi
      .fn()
      .mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(txClient),
      ),
    _txClient: txClient,
  };
}

// Db mock for the photo-cleanup path. The first select is the pre-replace
// photo-media capture; a second select occurs only on the photos-only path
// (no scalar update populated `updated`), where the handler re-reads the entry
// to build the response payload. Dispatching by call count keeps the two
// distinct so a photos-only patch is faithfully exercised.
function makeDbForPhotoPatch(
  updatedEntry: Record<string, unknown>,
  previousPhotoRows: { mediaId: string }[],
) {
  const returningMock = vi.fn().mockResolvedValue([updatedEntry]);
  const updateWhereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: updateWhereMock });

  const photoWhereMock = vi.fn().mockResolvedValue(previousPhotoRows);
  const photoFromMock = vi.fn().mockReturnValue({ where: photoWhereMock });
  const entryWhereMock = vi.fn().mockResolvedValue([updatedEntry]);
  const entryFromMock = vi.fn().mockReturnValue({ where: entryWhereMock });

  let selectCallCount = 0;
  const selectMock = vi.fn().mockImplementation(() => {
    selectCallCount += 1;
    if (selectCallCount === 1) {
      return { from: photoFromMock };
    }
    return { from: entryFromMock };
  });

  const txClient = {
    update: vi.fn().mockReturnValue({ set: setMock }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    select: selectMock,
  };

  return {
    transaction: vi
      .fn()
      .mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(txClient),
      ),
    _txClient: txClient,
  };
}

const handler = await import("../../../server/api/entries/[id].patch");

function invokeHandler(event: unknown): Promise<unknown> {
  const defaultHandler = "default" in handler ? handler.default : handler;
  return (defaultHandler as (event: unknown) => Promise<unknown>)(event);
}

describe("PATCH /api/entries/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadOwnedOrThrow.mockResolvedValue({
      id: "e-1",
      userId: "user-1",
    } as never);
    mockDeleteMediaIfUnreferenced.mockResolvedValue(true);
  });

  it("throws 400 when id param is missing", async () => {
    const missingError = createError({
      statusCode: 400,
      statusMessage: "id is required",
    });
    mockRequireRouterParam.mockImplementation(() => {
      throw missingError;
    });
    mockReadBody.mockResolvedValue({ title: "Updated" });

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when no fields are provided", async () => {
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({});
    const mockDb = makeDbForPatch({});
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when title is empty string", async () => {
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "   " });
    const mockDb = makeDbForPatch({});
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when visibility is invalid", async () => {
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ visibility: "secret" });
    const mockDb = makeDbForPatch({});
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when tags is not an array", async () => {
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ tags: "hiking" });
    const mockDb = makeDbForPatch({});
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 404 when entry is not owned", async () => {
    mockReadBody.mockResolvedValue({ title: "Updated" });
    await assertThrows404WhenNotOwned(
      mockRequireRouterParam,
      mockLoadOwnedOrThrow,
      handler,
    );
  });

  it("throws 401 when not authenticated", async () => {
    mockReadBody.mockResolvedValue({ title: "Updated" });
    await assertThrows401WhenUnauthenticated(
      mockRequireRouterParam,
      mockLoadOwnedOrThrow,
      handler,
    );
  });

  it("updates the entry title successfully", async () => {
    const updatedEntry = {
      id: "e-1",
      userId: "user-1",
      title: "Updated Title",
    };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Updated Title" });
    const mockDb = makeDbForPatch(updatedEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const result = await invokeHandler({});

    expect(result).toMatchObject(updatedEntry);
    expect(mockDb._txClient.update).toHaveBeenCalledTimes(1);
  });

  it("cleans up photo media the PATCH removed, scoped to the entry owner", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Keep" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({
      title: "Keep",
      photoMediaIds: ["media-2"],
    });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [
      { mediaId: "media-1" },
      { mediaId: "media-2" },
    ]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledTimes(1);
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "media-1",
    );
    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "media-2",
    );
  });

  it("does not clean up photo media the PATCH retained", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Keep" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({
      title: "Keep",
      photoMediaIds: ["media-1", "media-2"],
    });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [
      { mediaId: "media-1" },
      { mediaId: "media-2" },
    ]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("cleans up removed media and returns the entry on a photos-only patch", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Existing" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ photoMediaIds: [] });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [{ mediaId: "media-1" }]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const result = await invokeHandler({});

    expect(result).toMatchObject(updatedEntry);
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledTimes(1);
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "media-1",
    );
  });

  it("cleans up a media id shared by two photo rows only once", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Keep" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Keep", photoMediaIds: [] });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [
      { mediaId: "media-1" },
      { mediaId: "media-1" },
    ]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledTimes(1);
    expect(mockDeleteMediaIfUnreferenced).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "media-1",
    );
  });

  it("does not clean up any media when photos are not part of the patch", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Only title" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Only title" });
    const mockDb = makeDbForPatch(updatedEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("cleans up removed media only after the transaction commits", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Keep" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Keep", photoMediaIds: [] });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [{ mediaId: "media-1" }]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    const transactionOrder = mockDb.transaction.mock.invocationCallOrder[0];
    const cleanupOrder =
      mockDeleteMediaIfUnreferenced.mock.invocationCallOrder[0];
    expect(transactionOrder).toBeLessThan(cleanupOrder);
  });

  it("does not clean up media when the transaction fails", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Keep" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Keep", photoMediaIds: [] });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [{ mediaId: "media-1" }]);
    mockDb.transaction.mockRejectedValue(new Error("deadlock"));
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await expect(invokeHandler({})).rejects.toThrow("deadlock");
    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
  });

  it("still resolves and logs a summary when one removed media cleanup fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Keep" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Keep", photoMediaIds: [] });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [
      { mediaId: "media-1" },
      { mediaId: "media-2" },
    ]);
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

    expect(result).toMatchObject(updatedEntry);
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
});
