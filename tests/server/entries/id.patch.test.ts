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

vi.mock("../../../server/utils/media-helpers", () => ({
  assertPhotoMediaOwned: vi.fn(),
}));

vi.mock("../../../server/utils/place-helpers", () => ({
  assertPlaceOwnedIfPresent: vi.fn(),
}));

vi.mock("../../../server/utils/trip-helpers", () => ({
  assertTripOwnershipIfPresent: vi.fn(),
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
import { upsertTags } from "../../../server/utils/entry-helpers";
import { deleteMediaIfUnreferenced } from "../../../server/utils/coverImageCleanup";
import { assertPhotoMediaOwned } from "../../../server/utils/media-helpers";
import { assertPlaceOwnedIfPresent } from "../../../server/utils/place-helpers";
import { assertTripOwnershipIfPresent } from "../../../server/utils/trip-helpers";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockLoadOwnedOrThrow = vi.mocked(loadOwnedOrThrow);
const mockGetDb = vi.mocked(getDb);
const mockUpsertTags = vi.mocked(upsertTags);
const mockDeleteMediaIfUnreferenced = vi.mocked(deleteMediaIfUnreferenced);
const mockAssertPhotoMediaOwned = vi.mocked(assertPhotoMediaOwned);
const mockAssertPlaceOwnedIfPresent = vi.mocked(assertPlaceOwnedIfPresent);
const mockAssertTripOwnershipIfPresent = vi.mocked(
  assertTripOwnershipIfPresent,
);

// The neon-http driver has no interactive transactions, so the handler runs its
// writes sequentially on the base client. Each mock therefore exposes the write
// methods directly (no transaction wrapper) plus a `transaction` spy that must
// stay uncalled — the regression guard for issue #200, where a stray
// database.transaction() call 500s every entry PATCH.
function makeDbForPatch(updatedEntry: Record<string, unknown>) {
  const returningMock = vi.fn().mockResolvedValue([updatedEntry]);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: whereMock });

  const selectWhereMock = vi.fn().mockResolvedValue([updatedEntry]);
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });

  return {
    update: vi.fn().mockReturnValue({ set: setMock }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    select: vi.fn().mockReturnValue({ from: selectFromMock }),
    transaction: vi.fn(),
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

  return {
    update: vi.fn().mockReturnValue({ set: setMock }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    select: selectMock,
    transaction: vi.fn(),
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

  it("throws 404 when tripId belongs to another user and does not open a transaction", async () => {
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ tripId: "trip-other" });
    const mockDb = makeDbForPatch({ id: "e-1", userId: "user-1" });
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const notFoundError = createError({
      statusCode: 404,
      statusMessage: "Not found",
    });
    mockAssertTripOwnershipIfPresent.mockRejectedValueOnce(notFoundError);

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 404 });

    expect(mockAssertTripOwnershipIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "trip-other",
    );
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("validates trip ownership before updating when a tripId is supplied", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", tripId: "trip-1" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ tripId: "trip-1" });
    const mockDb = makeDbForPatch(updatedEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const result = await invokeHandler({});

    expect(mockAssertTripOwnershipIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "trip-1",
    );
    expect(result).toMatchObject(updatedEntry);
  });

  it("throws 404 when placeId belongs to another user and does not open a transaction", async () => {
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ placeId: "place-other" });
    const mockDb = makeDbForPatch({ id: "e-1", userId: "user-1" });
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    mockAssertPlaceOwnedIfPresent.mockRejectedValueOnce(
      createError({ statusCode: 404, statusMessage: "Place not found" }),
    );

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 404 });

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "place-other",
    );
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("calls the place check with undefined and still updates when no placeId is supplied", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Only title" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Only title" });
    const mockDb = makeDbForPatch(updatedEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      undefined,
    );
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("validates place ownership scoped to the entry owner when a placeId is supplied", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", placeId: "place-1" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ placeId: "place-1" });
    const mockDb = makeDbForPatch(updatedEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const result = await invokeHandler({});

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "place-1",
    );
    expect(result).toMatchObject(updatedEntry);
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
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("replaces tags via delete + insert without opening a transaction (issue #200)", async () => {
    // The neon-http driver throws on database.transaction(); the tag replace
    // must run sequentially on the base client instead.
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Trip" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Trip", tags: ["hiking"] });
    const mockDb = makeDbForPatch(updatedEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    mockUpsertTags.mockResolvedValueOnce(["tag-1"]);

    const result = await invokeHandler({});

    expect(result).toMatchObject(updatedEntry);
    // replaceEntryTags deletes the old entryTags rows, then inserts the new ones.
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("throws 404 and runs no transaction when a photoMediaId is not owned", async () => {
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ photoMediaIds: ["foreign-media"] });
    const mockDb = makeDbForPhotoPatch({ id: "e-1", userId: "user-1" }, []);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    mockAssertPhotoMediaOwned.mockRejectedValueOnce(
      createError({ statusCode: 404, statusMessage: "Photo media not found" }),
    );

    await expect(invokeHandler({})).rejects.toMatchObject({ statusCode: 404 });
    expect(mockAssertPhotoMediaOwned).toHaveBeenCalledWith(mockDb, "user-1", [
      "foreign-media",
    ]);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("does not validate photo ownership when photos are not part of the patch", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Only title" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Only title" });
    const mockDb = makeDbForPatch(updatedEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    expect(mockAssertPhotoMediaOwned).not.toHaveBeenCalled();
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

  it("cleans up removed media only after the photo replace commits", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Keep" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Keep", photoMediaIds: [] });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [{ mediaId: "media-1" }]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await invokeHandler({});

    // The photos-only patch replaces photos via a delete, then cleans up the
    // released media afterwards. The delete must run before the cleanup call.
    const replaceOrder = mockDb.delete.mock.invocationCallOrder[0];
    const cleanupOrder =
      mockDeleteMediaIfUnreferenced.mock.invocationCallOrder[0];
    expect(replaceOrder).toBeLessThan(cleanupOrder);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("does not clean up media when a write fails", async () => {
    const updatedEntry = { id: "e-1", userId: "user-1", title: "Keep" };
    mockRequireRouterParam.mockReturnValue("e-1");
    mockReadBody.mockResolvedValue({ title: "Keep", photoMediaIds: [] });
    const mockDb = makeDbForPhotoPatch(updatedEntry, [{ mediaId: "media-1" }]);
    // The photo-replace delete fails mid-sequence; the post-commit media cleanup
    // must not run.
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error("write failed")),
    });
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    await expect(invokeHandler({})).rejects.toThrow("write failed");
    expect(mockDeleteMediaIfUnreferenced).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
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
