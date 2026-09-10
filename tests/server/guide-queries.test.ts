/**
 * Unit tests for server/utils/guide-queries.ts — the guide read-visibility rule
 * exercised in isolation against a fake database.
 */
import { describe, it, expect, vi } from "vitest";

const mockCreateError = vi.fn(
  (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
);

Object.assign(globalThis, {
  createError: mockCreateError,
});

const { loadReadableGuide, loadReadableGuideWithAuthor } =
  await import("../../server/utils/guide-queries");

type FakeDatabase = Parameters<typeof loadReadableGuide>[0];
// `_limit` exposes the query-count spy so a test can assert a short-circuit
// path (e.g. a visibility rejection) never reached a later query, not just
// that it eventually threw.
type FakeDatabaseWithSpy = FakeDatabase & { _limit: ReturnType<typeof vi.fn> };

// Minimal stand-in for the query chains loadReadableGuide(WithAuthor) walks.
// loadReadableGuide issues up to two queries — the guide lookup, then (for a
// non-owner) the author's discoverability check. loadReadableGuideWithAuthor
// adds a third, always-run author byline lookup. Each `.limit()` returns the
// next queued response, shared by both describe blocks below.
function fakeDbSequence(
  responses: Record<string, unknown>[][],
): FakeDatabaseWithSpy {
  let call = 0;
  const limitMock = vi.fn(() => Promise.resolve(responses[call++] ?? []));
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: limitMock,
  };
  return {
    select: () => chain,
    _limit: limitMock,
  } as unknown as FakeDatabaseWithSpy;
}

const OWNER_ID = "user-owner";
const OTHER_ID = "user-other";

function guideRow(overrides: Record<string, unknown>) {
  return {
    id: "guide-1",
    userId: OWNER_ID,
    title: "Tokyo on foot",
    body: "Start in Yanaka at sunrise.",
    readTimeMinutes: 8,
    likeCount: 3,
    visibility: "private",
    ...overrides,
  };
}

describe("loadReadableGuide", () => {
  // A row from the author-discoverability query — its presence means the author
  // is live, public, and on explore.
  const discoverableOwner = [{ userId: OWNER_ID }];

  it("returns a private guide to its owner without a discoverability check", async () => {
    const guide = guideRow({ visibility: "private", userId: OWNER_ID });

    await expect(
      loadReadableGuide(fakeDbSequence([[guide]]), "guide-1", OWNER_ID),
    ).resolves.toEqual(guide);
  });

  it("returns a public guide to a non-owner when the author is discoverable", async () => {
    const guide = guideRow({ visibility: "public", userId: OWNER_ID });

    await expect(
      loadReadableGuide(
        fakeDbSequence([[guide], discoverableOwner]),
        "guide-1",
        OTHER_ID,
      ),
    ).resolves.toEqual(guide);
  });

  it("throws 404 for a private guide requested by a non-owner", async () => {
    const guide = guideRow({ visibility: "private", userId: OWNER_ID });

    await expect(
      loadReadableGuide(fakeDbSequence([[guide]]), "guide-1", OTHER_ID),
    ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
  });

  it("throws 404 for a public guide whose author is not discoverable (deleted / private / off-explore)", async () => {
    const guide = guideRow({ visibility: "public", userId: OWNER_ID });

    // Empty second response = the author fails the discoverability predicate.
    await expect(
      loadReadableGuide(fakeDbSequence([[guide], []]), "guide-1", OTHER_ID),
    ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
  });

  it("throws 404 when the guide does not exist", async () => {
    await expect(
      loadReadableGuide(fakeDbSequence([[]]), "missing", OWNER_ID),
    ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
  });

  it("returns a public guide to an anonymous (null) reader when the author is discoverable", async () => {
    const guide = guideRow({ visibility: "public", userId: OWNER_ID });

    await expect(
      loadReadableGuide(
        fakeDbSequence([[guide], discoverableOwner]),
        "guide-1",
        null,
      ),
    ).resolves.toEqual(guide);
  });

  it("throws 404 for a private guide requested by an anonymous (null) reader", async () => {
    const guide = guideRow({ visibility: "private", userId: OWNER_ID });

    await expect(
      loadReadableGuide(fakeDbSequence([[guide]]), "guide-1", null),
    ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
  });
});

describe("loadReadableGuideWithAuthor", () => {
  const discoverableOwner = [{ userId: OWNER_ID }];
  const authorRow = [{ displayName: "Elsa", handle: "elsa_far" }];

  it("merges the author's displayName/handle onto a guide read by its owner", async () => {
    const guide = guideRow({ visibility: "private", userId: OWNER_ID });

    await expect(
      loadReadableGuideWithAuthor(
        fakeDbSequence([[guide], authorRow]),
        "guide-1",
        OWNER_ID,
      ),
    ).resolves.toEqual({
      ...guide,
      ownerDisplayName: "Elsa",
      ownerHandle: "elsa_far",
    });
  });

  it("merges the author's displayName/handle onto a public guide read by a non-owner", async () => {
    const guide = guideRow({ visibility: "public", userId: OWNER_ID });

    await expect(
      loadReadableGuideWithAuthor(
        fakeDbSequence([[guide], discoverableOwner, authorRow]),
        "guide-1",
        OTHER_ID,
      ),
    ).resolves.toEqual({
      ...guide,
      ownerDisplayName: "Elsa",
      ownerHandle: "elsa_far",
    });
  });

  it("falls back to null displayName/handle when the author has no preferences row", async () => {
    const guide = guideRow({ visibility: "private", userId: OWNER_ID });

    await expect(
      loadReadableGuideWithAuthor(
        fakeDbSequence([[guide], []]),
        "guide-1",
        OWNER_ID,
      ),
    ).resolves.toEqual({
      ...guide,
      ownerDisplayName: null,
      ownerHandle: null,
    });
  });

  it("still throws 404 for a private guide requested by a non-owner (visibility check runs first)", async () => {
    const guide = guideRow({ visibility: "private", userId: OWNER_ID });
    const database = fakeDbSequence([[guide]]);

    await expect(
      loadReadableGuideWithAuthor(database, "guide-1", OTHER_ID),
    ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
    // Only the guide lookup ran — the visibility rejection short-circuits
    // before the author byline lookup ever queries, so a single queued
    // response ([[guide]], with none for a discoverability or author check)
    // suffices and the rest of the queue stays untouched.
    expect(database._limit).toHaveBeenCalledTimes(1);
  });
});
