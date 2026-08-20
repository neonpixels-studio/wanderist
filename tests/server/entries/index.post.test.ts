import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";
import { makeDbForDelete } from "./_helpers";

stubNitroGlobals();

const mockReadBody = vi.fn();
vi.stubGlobal("readBody", mockReadBody);

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
  ensureUser: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
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
  parseVisibility: vi.fn().mockReturnValue("private"),
  parseRequiredStringArray: vi.fn((value: unknown, fieldName: string) => {
    if (value === undefined || value === null) {
      return [];
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
}));

import { ensureUser } from "../../../server/utils/auth";
import { getDb } from "../../../server/db/index";
import { upsertTags } from "../../../server/utils/entry-helpers";
import { assertPhotoMediaOwned } from "../../../server/utils/media-helpers";
import { assertPlaceOwnedIfPresent } from "../../../server/utils/place-helpers";
import { assertTripOwnershipIfPresent } from "../../../server/utils/trip-helpers";

const mockEnsureUser = vi.mocked(ensureUser);
const mockGetDb = vi.mocked(getDb);
const mockUpsertTags = vi.mocked(upsertTags);
const mockAssertPhotoMediaOwned = vi.mocked(assertPhotoMediaOwned);
const mockAssertPlaceOwnedIfPresent = vi.mocked(assertPlaceOwnedIfPresent);
const mockAssertTripOwnershipIfPresent = vi.mocked(
  assertTripOwnershipIfPresent,
);

function makeDbForCreate(createdEntry: Record<string, unknown>) {
  const returningMock = vi.fn().mockResolvedValue([createdEntry]);
  const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });

  // The handler no longer wraps writes in database.transaction() — the
  // neon-http driver used everywhere in this app has no transaction support
  // (see the comment in server/api/entries/index.post.ts) — so it calls
  // database.insert(...) directly.
  return {
    insert: vi.fn().mockImplementation(() => ({ values: valuesMock })),
  };
}

const handler = await import("../../../server/api/entries/index.post");

describe("POST /api/entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["title is missing", { body: "Some content" }],
    ["title is empty", { title: "   " }],
    ["occurredAt is not a valid date", { title: "Entry", occurredAt: "bad" }],
    ["tags is not an array", { title: "Entry", tags: "hiking" }],
    ["photoMediaIds is not an array", { title: "Entry", photoMediaIds: "m-1" }],
  ])("throws 400 when %s", async (_label, body) => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue(body);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 401 when not authenticated", async () => {
    const unauthorizedError = createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
    mockEnsureUser.mockRejectedValue(unauthorizedError);
    mockReadBody.mockResolvedValue({ title: "My Entry" });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 404 and inserts nothing when a photoMediaId is not owned", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({
      title: "My Entry",
      photoMediaIds: ["foreign-media"],
    });
    const mockDb = makeDbForCreate({ id: "e-1" });
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    mockAssertPhotoMediaOwned.mockRejectedValueOnce(
      createError({ statusCode: 404, statusMessage: "Photo media not found" }),
    );

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockAssertPhotoMediaOwned).toHaveBeenCalledWith(mockDb, "user-1", [
      "foreign-media",
    ]);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("creates an entry with only required fields", async () => {
    const createdEntry = {
      id: "e-1",
      userId: "user-1",
      title: "My Entry",
      body: null,
      tripId: null,
      placeId: null,
      weather: null,
      occurredAt: null,
      visibility: "private",
      likeCount: 0,
    };
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ title: "My Entry" });
    const mockDb = makeDbForCreate(createdEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(result).toMatchObject(createdEntry);
  });

  it("throws 404 when tripId belongs to another user and does not insert", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ title: "My Entry", tripId: "trip-other" });
    const mockDb = makeDbForCreate({ id: "e-1" });
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const notFoundError = createError({
      statusCode: 404,
      statusMessage: "Not found",
    });
    mockAssertTripOwnershipIfPresent.mockRejectedValueOnce(notFoundError);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockAssertTripOwnershipIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "trip-other",
    );
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("throws 404 when placeId belongs to another user and does not insert", async () => {
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({
      title: "My Entry",
      placeId: "place-other",
    });
    const mockDb = makeDbForCreate({ id: "e-1" });
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    mockAssertPlaceOwnedIfPresent.mockRejectedValueOnce(
      createError({ statusCode: 404, statusMessage: "Place not found" }),
    );

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "place-other",
    );
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("calls the place check with undefined and still inserts when no placeId is supplied", async () => {
    const createdEntry = { id: "e-1", userId: "user-1" };
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ title: "My Entry" });
    const mockDb = makeDbForCreate(createdEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    await (defaultHandler as (event: unknown) => unknown)({});

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      undefined,
    );
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("validates place ownership before inserting when a placeId is supplied", async () => {
    const createdEntry = { id: "e-1", userId: "user-1", placeId: "place-1" };
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ title: "My Entry", placeId: "place-1" });
    const mockDb = makeDbForCreate(createdEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(mockAssertPlaceOwnedIfPresent).toHaveBeenCalledWith(
      mockDb,
      "user-1",
      "place-1",
    );
    expect(result).toMatchObject(createdEntry);
  });

  it("validates trip ownership before inserting when a tripId is supplied", async () => {
    const createdEntry = { id: "e-1", userId: "user-1", tripId: "trip-1" };
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ title: "My Entry", tripId: "trip-1" });
    const mockDb = makeDbForCreate(createdEntry);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(mockAssertTripOwnershipIfPresent).toHaveBeenCalledWith(
      expect.anything(),
      "trip-1",
    );
    expect(result).toMatchObject(createdEntry);
  });

  it("deletes the orphaned entry and rethrows when a post-insert step fails", async () => {
    const createdEntry = { id: "generated-id", userId: "user-1" };
    mockEnsureUser.mockResolvedValue("user-1");
    mockReadBody.mockResolvedValue({ title: "My Entry" });
    const mockDb = {
      ...makeDbForCreate(createdEntry),
      ...makeDbForDelete(),
    };
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const upsertError = new Error("tag upsert failed");
    mockUpsertTags.mockRejectedValueOnce(upsertError);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toThrow(upsertError);

    expect(mockDb.delete).toHaveBeenCalledTimes(1);
  });
});
