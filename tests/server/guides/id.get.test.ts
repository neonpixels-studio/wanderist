import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();
// The handler sets response cache headers; stub the Nitro auto-import so it can
// run outside the Nuxt runtime.
const mockSetResponseHeader = vi.fn();
vi.stubGlobal("setResponseHeader", mockSetResponseHeader);

// requireRouterParam is stubbed (it reads the event's route params); the
// visibility rule under test lives in the real loadReadableGuide from
// guide-queries.ts, so it is intentionally NOT mocked — a regression there
// fails these tests.
vi.mock("../../../server/utils/db-helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../server/utils/db-helpers")>();
  return {
    ...actual,
    requireRouterParam: vi.fn(),
  };
});

// Only optionalUser is mocked (not requireUser): the handler must resolve the
// caller via optionalUser so anonymous reads are allowed. If it regresses to a
// blanket requireUser, that import is undefined here and the handler throws —
// failing these tests loudly rather than silently re-gating public guides.
vi.mock("../../../server/utils/auth", () => ({
  optionalUser: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original, eq: vi.fn(original.eq) };
});

import { eq } from "drizzle-orm";
import { requireRouterParam } from "../../../server/utils/db-helpers";
import { optionalUser } from "../../../server/utils/auth";
import { getDb } from "../../../server/db/index";
import { guides } from "../../../server/db/schema";

const mockEq = vi.mocked(eq);
const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockOptionalUser = vi.mocked(optionalUser);
const mockGetDb = vi.mocked(getDb);

// The handler may issue up to two queries (the guide lookup, then a non-owner
// author-discoverability check that uses innerJoin), so each `.limit()` returns
// the next queued response.
function makeDb(responses: Record<string, unknown>[][]) {
  let call = 0;
  const limitMock = vi.fn(() => Promise.resolve(responses[call++] ?? []));
  const whereMock = vi.fn(() => ({ limit: limitMock }));
  const innerJoinMock = vi.fn(() => ({ where: whereMock }));
  const fromMock = vi.fn(() => ({
    where: whereMock,
    innerJoin: innerJoinMock,
  }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  return { select: selectMock, _where: whereMock, _limit: limitMock };
}

const OWNER_ID = "user-owner";
const OTHER_ID = "user-other";

function makeGuide(overrides: Record<string, unknown>) {
  return {
    id: "guide-1",
    userId: OWNER_ID,
    title: "Tokyo on foot",
    body: "Start in Yanaka at sunrise.",
    readTimeMinutes: 8,
    likeCount: 3,
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const handler = await import("../../../server/api/guides/[id].get");

function runHandler() {
  return (handler.default as (event: unknown) => Promise<unknown>)({});
}

describe("GET /api/guides/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRouterParam.mockReturnValue("guide-1");
  });

  it("returns a private guide to its owner, including the body", async () => {
    const guide = makeGuide({ visibility: "private", userId: OWNER_ID });
    mockOptionalUser.mockReturnValue(OWNER_ID);
    const mockDb = makeDb([[guide]]);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const result = await runHandler();

    expect(result).toEqual(guide);
    expect((result as { body: string }).body).toBe(
      "Start in Yanaka at sunrise.",
    );
    // The lookup must filter on the guide id and take a single row — a
    // regression to the wrong column or a dropped limit fails here rather
    // than silently returning someone else's guide.
    expect(mockEq).toHaveBeenCalledWith(guides.id, "guide-1");
    expect(mockDb._where).toHaveBeenCalledTimes(1);
    expect(mockDb._limit).toHaveBeenCalledWith(1);
  });

  it("returns a public guide to a non-owner when the author is discoverable", async () => {
    const guide = makeGuide({ visibility: "public", userId: OWNER_ID });
    mockOptionalUser.mockReturnValue(OTHER_ID);
    // Second response is non-empty: the author passes the discoverability check.
    mockGetDb.mockReturnValue(
      makeDb([[guide], [{ userId: OWNER_ID }]]) as unknown as ReturnType<
        typeof getDb
      >,
    );

    const result = await runHandler();

    expect(result).toEqual(guide);
  });

  it("hides a private guide from a non-owner with a 404", async () => {
    const guide = makeGuide({ visibility: "private", userId: OWNER_ID });
    mockOptionalUser.mockReturnValue(OTHER_ID);
    mockGetDb.mockReturnValue(
      makeDb([[guide]]) as unknown as ReturnType<typeof getDb>,
    );

    await expect(runHandler()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("hides a public guide whose author is not discoverable with a 404", async () => {
    const guide = makeGuide({ visibility: "public", userId: OWNER_ID });
    mockOptionalUser.mockReturnValue(OTHER_ID);
    // Empty second response: the author is deleted / private / off-explore.
    mockGetDb.mockReturnValue(
      makeDb([[guide], []]) as unknown as ReturnType<typeof getDb>,
    );

    await expect(runHandler()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 404 when the guide does not exist", async () => {
    mockOptionalUser.mockReturnValue(OWNER_ID);
    mockGetDb.mockReturnValue(
      makeDb([[]]) as unknown as ReturnType<typeof getDb>,
    );

    await expect(runHandler()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns a public guide to an anonymous visitor when the author is discoverable", async () => {
    const guide = makeGuide({ visibility: "public", userId: OWNER_ID });
    // Anonymous visitor: no session, so optionalUser resolves to null.
    mockOptionalUser.mockReturnValue(null);
    mockGetDb.mockReturnValue(
      makeDb([[guide], [{ userId: OWNER_ID }]]) as unknown as ReturnType<
        typeof getDb
      >,
    );

    const result = await runHandler();

    expect(result).toEqual(guide);
  });

  it("hides a private guide from an anonymous visitor with a 404", async () => {
    const guide = makeGuide({ visibility: "private", userId: OWNER_ID });
    mockOptionalUser.mockReturnValue(null);
    mockGetDb.mockReturnValue(
      makeDb([[guide]]) as unknown as ReturnType<typeof getDb>,
    );

    await expect(runHandler()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("marks the response private/uncacheable and varies on Authorization", async () => {
    const guide = makeGuide({ visibility: "public", userId: OWNER_ID });
    mockOptionalUser.mockReturnValue(null);
    mockGetDb.mockReturnValue(
      makeDb([[guide], [{ userId: OWNER_ID }]]) as unknown as ReturnType<
        typeof getDb
      >,
    );

    await runHandler();

    // A per-viewer body must never be served from a shared cache.
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "private, no-store",
    );
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Vary",
      "Authorization",
    );
  });
});
