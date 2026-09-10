import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";
import { asc, inArray } from "drizzle-orm";
import { entryPhotos, entryTags } from "../../../server/db/schema";
import {
  loadEntryRelations,
  loadRelationsForEntries,
  parseStringArray,
  parseRequiredStringArray,
  upsertTags,
  MAX_STRING_ARRAY_LENGTH,
} from "../../../server/utils/entry-helpers";
import type { getDb } from "../../../server/db/index";

stubNitroGlobals();

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    asc: vi.fn(original.asc),
    inArray: vi.fn(original.inArray),
  };
});

const mockAsc = vi.mocked(asc);
const mockInArray = vi.mocked(inArray);

/**
 * Builds a fake database whose `select()` returns the photo query chain when
 * called with no projection (as `fetchPhotosForEntries` calls it) and the
 * tag query chain when called with a projection object (as
 * `fetchTagsForEntries` calls it). Dispatching on call shape, rather than
 * call order, keeps this fake correct even if the two batched fetches were
 * reordered inside `Promise.all`. Returns the `orderBy` spy for the photo
 * chain so callers can assert the batched photo query still sorts by
 * `sortOrder` (batching moves this from a per-entry to a global ORDER BY;
 * dropping it would silently scramble photo order within an entry).
 */
function createFakeDatabase(photoRows: unknown[], tagRows: unknown[]) {
  const photoOrderBy = vi.fn().mockResolvedValue(photoRows);
  const photoChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: photoOrderBy,
      }),
    }),
  };
  const tagChain = {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(tagRows),
      }),
    }),
  };
  const select = vi
    .fn()
    .mockImplementation((projection?: unknown) =>
      projection ? tagChain : photoChain,
    );

  return { select, photoOrderBy } as unknown as ReturnType<typeof getDb> & {
    photoOrderBy: typeof photoOrderBy;
  };
}

/**
 * Builds a fake database for upsertTags. Each insert().values() call returns
 * a chain ending in .returning() resolving to the id mapped from `idsByName`
 * (falling back to the generated row's own id, mirroring onConflictDoUpdate
 * returning the existing row's real id). `batch` awaits every statement it's
 * given, matching drizzle's real "one HTTP call, every statement resolves
 * together" behaviour closely enough for these unit tests. `insertedNames`
 * records the name from every insert().values() call, in call order, so
 * tests can assert the row-lock acquisition order regardless of the caller's
 * input order (see the deadlock-avoidance comment on upsertTags).
 */
function createFakeDatabaseForUpsertTags(idsByName: Record<string, string>) {
  const insertedNames: string[] = [];
  const batch = vi.fn((statements: Promise<{ id: string }[]>[]) =>
    Promise.all(statements),
  );
  const insert = vi.fn(() => ({
    values: vi.fn((row: { id: string; name: string }) => {
      insertedNames.push(row.name);
      return {
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi
            .fn()
            .mockResolvedValue([{ id: idsByName[row.name] ?? row.id }]),
        })),
      };
    }),
  }));

  return {
    insert,
    batch,
    insertedNames,
  } as unknown as ReturnType<typeof getDb> & { insertedNames: string[] };
}

describe("upsertTags", () => {
  it("returns an empty array without touching the database when there are no tag names", async () => {
    const database = createFakeDatabaseForUpsertTags({});

    const result = await upsertTags(database, []);

    expect(result).toEqual([]);
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.batch).not.toHaveBeenCalled();
  });

  it("upserts every unique tag name in one atomic batch call, returning ids in the caller's order", async () => {
    const database = createFakeDatabaseForUpsertTags({
      Beach: "tag-beach",
      Hiking: "tag-hiking",
    });

    const result = await upsertTags(database, ["Beach", "Hiking", "Beach"]);

    // "Beach" appears twice in the input but is deduped to one statement, and
    // the result preserves the caller's (deduped) order even though the
    // statements are issued in a different, lock-safe order (see below).
    expect(result).toEqual(["tag-beach", "tag-hiking"]);
    expect(database.batch).toHaveBeenCalledTimes(1);
    const batchedStatements = (database.batch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as unknown[];
    expect(batchedStatements).toHaveLength(2);
    expect(database.insert).toHaveBeenCalledTimes(2);
  });

  it("acquires row locks in a fixed, sorted order regardless of the caller's input order", async () => {
    // onConflictDoUpdate holds a row-level lock for the life of the batch's
    // transaction. Two concurrent calls upserting the same tag pair in
    // opposite input orders would deadlock unless every caller locks them in
    // the same order — so upsertTags must sort before issuing statements,
    // not follow the caller's array order.
    const database = createFakeDatabaseForUpsertTags({
      Beach: "tag-beach",
      Hiking: "tag-hiking",
    });

    await upsertTags(database, ["Hiking", "Beach"]);

    expect(database.insertedNames).toEqual(["Beach", "Hiking"]);
  });
});

describe("parseStringArray", () => {
  it("returns undefined when the value is absent", () => {
    expect(parseStringArray(undefined, "photoMediaIds")).toBeUndefined();
    expect(parseStringArray(null, "photoMediaIds")).toBeUndefined();
  });

  it("accepts a valid list of non-blank strings", () => {
    expect(parseStringArray(["a", "b", "c"], "photoMediaIds")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns an empty array unchanged so callers can distinguish clear-all from absent", () => {
    expect(parseStringArray([], "photoMediaIds")).toEqual([]);
  });

  it("trims surrounding whitespace so padded ids match their lookup", () => {
    expect(parseStringArray([" a ", "b\t"], "photoMediaIds")).toEqual([
      "a",
      "b",
    ]);
  });

  it("accepts a list exactly at the max length", () => {
    const atLimit = Array.from(
      { length: MAX_STRING_ARRAY_LENGTH },
      (_unused, index) => `id-${index}`,
    );
    expect(parseStringArray(atLimit, "photoMediaIds")).toEqual(atLimit);
  });

  it("rejects a list longer than the max length with a 400", () => {
    const overLimit = Array.from(
      { length: MAX_STRING_ARRAY_LENGTH + 1 },
      (_unused, index) => `id-${index}`,
    );
    expect(() => parseStringArray(overLimit, "photoMediaIds")).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        statusMessage: `photoMediaIds must not contain more than ${MAX_STRING_ARRAY_LENGTH} items`,
      }),
    );
  });

  it("rejects an empty-string id with a 400", () => {
    expect(() => parseStringArray(["a", ""], "photoMediaIds")).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        statusMessage: "photoMediaIds must not contain blank values",
      }),
    );
  });

  it("rejects a whitespace-only id with a 400", () => {
    expect(() => parseStringArray(["a", "   "], "photoMediaIds")).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        statusMessage: "photoMediaIds must not contain blank values",
      }),
    );
  });

  it("rejects a non-string element with a 400", () => {
    expect(() =>
      parseStringArray(["a", 42] as unknown, "photoMediaIds"),
    ).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        statusMessage: "photoMediaIds must be an array of strings",
      }),
    );
  });

  it("rejects a non-array value with a 400", () => {
    const nonArrays: unknown[] = ["nope", {}, 42];
    for (const nonArray of nonArrays) {
      expect(() => parseStringArray(nonArray, "photoMediaIds")).toThrowError(
        expect.objectContaining({
          statusCode: 400,
          statusMessage: "photoMediaIds must be an array when provided",
        }),
      );
    }
  });
});

describe("parseRequiredStringArray", () => {
  it("returns an empty array when the value is absent", () => {
    expect(parseRequiredStringArray(undefined, "tags")).toEqual([]);
    expect(parseRequiredStringArray(null, "tags")).toEqual([]);
  });

  it("passes a valid list through unchanged", () => {
    expect(parseRequiredStringArray(["a", "b"], "tags")).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty list", () => {
    expect(parseRequiredStringArray([], "tags")).toEqual([]);
  });

  it("trims surrounding whitespace on each tag", () => {
    expect(parseRequiredStringArray([" a ", "b"], "tags")).toEqual(["a", "b"]);
  });

  it("rejects an over-limit list with a 400", () => {
    const overLimit = Array.from(
      { length: MAX_STRING_ARRAY_LENGTH + 1 },
      (_unused, index) => `id-${index}`,
    );
    expect(() => parseRequiredStringArray(overLimit, "tags")).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        statusMessage: `tags must not contain more than ${MAX_STRING_ARRAY_LENGTH} items`,
      }),
    );
  });

  it("rejects a blank id with a 400", () => {
    expect(() => parseRequiredStringArray(["ok", " "], "tags")).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        statusMessage: "tags must not contain blank values",
      }),
    );
  });
});

describe("loadRelationsForEntries", () => {
  beforeEach(() => {
    mockAsc.mockClear();
    mockInArray.mockClear();
  });

  it("scopes both batched queries to the requested entryIds", async () => {
    const database = createFakeDatabase([], []);

    await loadRelationsForEntries(database, ["e-1", "e-2"]);

    expect(mockInArray).toHaveBeenCalledWith(entryPhotos.entryId, [
      "e-1",
      "e-2",
    ]);
    expect(mockInArray).toHaveBeenCalledWith(entryTags.entryId, ["e-1", "e-2"]);
  });

  it("still sorts the batched photo query by sortOrder", async () => {
    const database = createFakeDatabase([], []);

    await loadRelationsForEntries(database, ["e-1", "e-2"]);

    expect(database.photoOrderBy).toHaveBeenCalledWith(
      asc(entryPhotos.sortOrder),
    );
  });

  it("returns an empty map and issues no queries when entryIds is empty", async () => {
    const database = createFakeDatabase([], []);

    const result = await loadRelationsForEntries(database, []);

    expect(result.size).toBe(0);
    expect(database.select).not.toHaveBeenCalled();
  });

  it("seeds every requested entryId with empty photos/tags before merging results", async () => {
    const database = createFakeDatabase([], []);

    const result = await loadRelationsForEntries(database, ["e-1", "e-2"]);

    expect(result.get("e-1")).toEqual({ photos: [], tags: [] });
    expect(result.get("e-2")).toEqual({ photos: [], tags: [] });
  });

  it("associates photos and tags to the correct entry, not just the first one", async () => {
    const photoRows = [
      { id: "p-1", entryId: "e-2", mediaId: "m-1", sortOrder: 0 },
      { id: "p-2", entryId: "e-1", mediaId: "m-2", sortOrder: 0 },
      { id: "p-3", entryId: "e-1", mediaId: "m-3", sortOrder: 1 },
    ];
    const tagRows = [
      { entryId: "e-2", tagId: "t-1", tagName: "beach" },
      { entryId: "e-1", tagId: "t-2", tagName: "mountains" },
    ];
    const database = createFakeDatabase(photoRows, tagRows);

    const result = await loadRelationsForEntries(database, ["e-1", "e-2"]);

    expect(result.get("e-1")?.photos.map((photo) => photo.id)).toEqual([
      "p-2",
      "p-3",
    ]);
    expect(result.get("e-1")?.tags).toEqual([{ id: "t-2", name: "mountains" }]);

    expect(result.get("e-2")?.photos.map((photo) => photo.id)).toEqual(["p-1"]);
    expect(result.get("e-2")?.tags).toEqual([{ id: "t-1", name: "beach" }]);
  });

  it("ignores relation rows for entries outside the requested set", async () => {
    const photoRows = [
      { id: "p-1", entryId: "e-999", mediaId: "m-1", sortOrder: 0 },
    ];
    const tagRows = [{ entryId: "e-999", tagId: "t-1", tagName: "beach" }];
    const database = createFakeDatabase(photoRows, tagRows);

    const result = await loadRelationsForEntries(database, ["e-1"]);

    expect(result.get("e-1")).toEqual({ photos: [], tags: [] });
    expect(result.has("e-999")).toBe(false);
  });
});

describe("loadEntryRelations", () => {
  it("delegates to loadRelationsForEntries for a single entry", async () => {
    const photoRows = [
      { id: "p-1", entryId: "e-1", mediaId: "m-1", sortOrder: 0 },
    ];
    const tagRows = [{ entryId: "e-1", tagId: "t-1", tagName: "beach" }];
    const database = createFakeDatabase(photoRows, tagRows);

    const result = await loadEntryRelations(database, "e-1");

    expect(result.photos.map((photo) => photo.id)).toEqual(["p-1"]);
    expect(result.tags).toEqual([{ id: "t-1", name: "beach" }]);
  });

  it("returns empty photos/tags for an entry with no relations", async () => {
    const database = createFakeDatabase([], []);

    const result = await loadEntryRelations(database, "e-1");

    expect(result).toEqual({ photos: [], tags: [] });
  });
});
