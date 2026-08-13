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
import { assertTripOwnershipIfPresent } from "../../../server/utils/trip-helpers";

const mockEnsureUser = vi.mocked(ensureUser);
const mockGetDb = vi.mocked(getDb);
const mockUpsertTags = vi.mocked(upsertTags);
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
