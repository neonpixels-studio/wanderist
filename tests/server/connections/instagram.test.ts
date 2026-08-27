/**
 * Unit tests for the Instagram connection API handlers.
 *
 * All external dependencies (DB, Instagram client, crypto, Nitro globals)
 * are mocked so no network or database access occurs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { entries, media } from "../../../server/db/schema";

// ---------------------------------------------------------------------------
// Hoist mock factories
// ---------------------------------------------------------------------------

const {
  mockRequireUser,
  mockEnsureUser,
  mockGetDb,
  mockDbInsert,
  mockDbInsertValues,
  mockDbInsertOnConflict,
  mockDbInsertReturning,
  mockDbSelect,
  mockDbSelectFrom,
  mockDbSelectWhere,
  mockDbSelectLimit,
  mockDbDelete,
  mockDbDeleteWhere,
  mockBuildInstagramAuthUrl,
  mockExchangeInstagramCode,
  mockExchangeForLongLivedToken,
  mockFetchInstagramUser,
  mockFetchInstagramMedia,
  mockFetchInstagramImage,
  mockFilterGeotaggedMedia,
  mockEncryptToken,
  mockDecryptToken,
  mockEnsureFreshInstagramToken,
  MockInstagramTokenExpiredError,
  mockPutMediaBlob,
  mockToThumbnailKey,
  mockProbeImageDimensions,
  mockGenerateThumbnail,
  mockGetCookie,
  mockSetCookie,
  mockDeleteCookie,
  mockSendRedirect,
  mockGetQuery,
  mockReadBody,
  mockSetResponseStatus,
  mockAssertInstagramSyncAllowed,
} = vi.hoisted(() => {
  const mockDbInsertOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockDbInsertReturning = vi.fn().mockResolvedValue([{ id: "new-id" }]);
  // values() is awaitable (entryPhotos inserts without .returning()) and also
  // exposes .returning() (places/entries/media) and .onConflictDoUpdate()
  // (token upserts) — the neon-http import path now writes sequentially on the
  // base client instead of inside database.transaction().
  const mockDbInsertValues = vi.fn(() => {
    const thenable = Promise.resolve(undefined);
    return Object.assign(thenable, {
      onConflictDoUpdate: mockDbInsertOnConflict,
      returning: mockDbInsertReturning,
    });
  });
  const mockDbInsert = vi.fn(() => ({
    values: mockDbInsertValues,
  }));

  const mockDbDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockDbDelete = vi.fn(() => ({ where: mockDbDeleteWhere }));

  // mockDbSelectWhere is awaitable (for the dedupe query that has no .limit())
  // and also exposes .limit() for the connection-lookup query.
  const mockDbSelectLimit = vi.fn().mockResolvedValue([]);
  const mockDbSelectWhere = vi.fn().mockImplementation(() => {
    const thenable = Promise.resolve([] as unknown[]);
    return Object.assign(thenable, { limit: mockDbSelectLimit });
  });
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectWhere }));
  const mockDbSelect = vi.fn(() => ({ from: mockDbSelectFrom }));

  const mockGetDb = vi.fn(() => ({
    insert: mockDbInsert,
    delete: mockDbDelete,
    select: mockDbSelect,
  }));

  return {
    mockRequireUser: vi.fn().mockReturnValue("user-1"),
    mockEnsureUser: vi.fn().mockResolvedValue("user-1"),
    mockGetDb,
    mockDbInsert,
    mockDbInsertValues,
    mockDbInsertOnConflict,
    mockDbInsertReturning,
    mockDbSelect,
    mockDbSelectFrom,
    mockDbSelectWhere,
    mockDbSelectLimit,
    mockDbDelete,
    mockDbDeleteWhere,
    mockBuildInstagramAuthUrl: vi
      .fn()
      .mockReturnValue("https://instagram.com/oauth/authorize?foo"),
    mockExchangeInstagramCode: vi
      .fn()
      .mockResolvedValue({ access_token: "short-token", token_type: "bearer" }),
    mockExchangeForLongLivedToken: vi.fn().mockResolvedValue({
      access_token: "long-token",
      token_type: "bearer",
      expires_in: 5183944,
    }),
    mockFetchInstagramUser: vi
      .fn()
      .mockResolvedValue({ id: "ig-123", username: "testuser" }),
    mockFetchInstagramMedia: vi.fn().mockResolvedValue({ data: [] }),
    mockFetchInstagramImage: vi
      .fn()
      .mockResolvedValue(Buffer.from("fake-image-bytes")),
    mockFilterGeotaggedMedia: vi.fn().mockReturnValue([]),
    mockEncryptToken: vi.fn().mockReturnValue("encrypted-token"),
    mockDecryptToken: vi.fn().mockReturnValue("long-token"),
    mockEnsureFreshInstagramToken: vi.fn().mockResolvedValue("long-token"),
    MockInstagramTokenExpiredError: class extends Error {},
    mockPutMediaBlob: vi.fn().mockResolvedValue(undefined),
    // Mirrors the real suffix convention so tests can assert the derived key.
    mockToThumbnailKey: vi.fn((storageKey: string) => `${storageKey}-thumb`),
    mockProbeImageDimensions: vi
      .fn()
      .mockResolvedValue({ width: 1200, height: 800 }),
    mockGenerateThumbnail: vi.fn().mockResolvedValue(Buffer.from("thumb")),
    mockGetCookie: vi.fn(),
    mockSetCookie: vi.fn(),
    mockDeleteCookie: vi.fn(),
    mockSendRedirect: vi.fn().mockResolvedValue(undefined),
    mockGetQuery: vi.fn().mockReturnValue({}),
    mockReadBody: vi.fn().mockResolvedValue({}),
    mockSetResponseStatus: vi.fn(),
    mockAssertInstagramSyncAllowed: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../../server/utils/auth", () => ({
  requireUser: mockRequireUser,
  ensureUser: mockEnsureUser,
}));

vi.mock("../../../server/db/index", () => ({
  getDb: mockGetDb,
}));

vi.mock("../../../server/utils/instagramClient", () => ({
  buildInstagramAuthUrl: mockBuildInstagramAuthUrl,
  exchangeInstagramCode: mockExchangeInstagramCode,
  exchangeForLongLivedToken: mockExchangeForLongLivedToken,
  fetchInstagramUser: mockFetchInstagramUser,
  fetchInstagramMedia: mockFetchInstagramMedia,
  fetchInstagramImage: mockFetchInstagramImage,
  filterGeotaggedMedia: mockFilterGeotaggedMedia,
  INSTAGRAM_SCOPES: "instagram_basic,instagram_manage_media",
  INSTAGRAM_MEDIA_FIELDS:
    "id,caption,media_type,timestamp,permalink,media_url,location",
  INSTAGRAM_MEDIA_LIMIT: 50,
  INSTAGRAM_GEOTAGGED_MEDIA_TYPES: new Set(["IMAGE", "CAROUSEL_ALBUM"]),
  // Lowered from the production cap so the per-run bound is exercised with a
  // small fixture: three new items overflow a cap of two.
  INSTAGRAM_IMPORT_MAX_ITEMS_PER_RUN: 2,
  // Large so the wall-time budget never trips inside these fast, mocked tests;
  // the count cap is what the fixtures exercise.
  INSTAGRAM_IMPORT_TIME_BUDGET_MS: 60000,
}));

vi.mock("../../../server/utils/tokenCrypto", () => ({
  encryptToken: mockEncryptToken,
  decryptToken: mockDecryptToken,
}));

const MS_PER_DAY_FOR_MOCK = 24 * 60 * 60 * 1000;
vi.mock("../../../server/utils/instagramToken", () => ({
  ensureFreshInstagramToken: mockEnsureFreshInstagramToken,
  InstagramTokenExpiredError: MockInstagramTokenExpiredError,
  // Mirror the real expiryFromResponse: derive from expires_in, else fall back
  // to Instagram's 60-day lifetime (never null).
  expiryFromResponse: (response: { expires_in?: number }, now: Date): Date =>
    typeof response.expires_in === "number"
      ? new Date(now.getTime() + response.expires_in * 1000)
      : new Date(now.getTime() + 60 * MS_PER_DAY_FOR_MOCK),
}));

vi.mock("../../../server/utils/planLimits", () => ({
  assertInstagramSyncAllowed: mockAssertInstagramSyncAllowed,
}));

vi.mock("../../../server/utils/mediaStore", () => ({
  putMediaBlob: mockPutMediaBlob,
  toThumbnailKey: mockToThumbnailKey,
}));

vi.mock("../../../server/utils/imageProcessing", () => ({
  probeImageDimensions: mockProbeImageDimensions,
  generateThumbnail: mockGenerateThumbnail,
}));

// Nitro/h3 globals
Object.assign(globalThis, {
  defineEventHandler: (handler: (event: unknown) => unknown) => handler,
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
  requireNuxtApp: vi.fn(),
  getCookie: mockGetCookie,
  setCookie: mockSetCookie,
  deleteCookie: mockDeleteCookie,
  sendRedirect: mockSendRedirect,
  getQuery: mockGetQuery,
  readBody: mockReadBody,
  setResponseStatus: mockSetResponseStatus,
  getRouterParam: vi.fn(),
  getHeader: vi.fn(),
  useRuntimeConfig: vi.fn(() => ({
    databaseUrl: "postgres://test",
    instagramClientId: "",
    instagramClientSecret: "",
    public: { siteOrigin: "" },
  })),
});

// ---------------------------------------------------------------------------
// Import handlers after mocks
// ---------------------------------------------------------------------------

const { default: startHandler } =
  await import("../../../server/api/connections/instagram/start.get");
const { default: callbackHandler } =
  await import("../../../server/api/connections/instagram/callback.get");
const { default: statusHandler } =
  await import("../../../server/api/connections/instagram/index.get");
const { default: deleteHandler } =
  await import("../../../server/api/connections/instagram/index.delete");
const { default: importHandler } =
  await import("../../../server/api/connections/instagram/import.post");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Handler = (event: unknown) => Promise<unknown>;

function call(handler: unknown, event: unknown): Promise<unknown> {
  return (handler as Handler)(event);
}

function makeEvent(): object {
  return { context: { userId: "user-1" } };
}

// ---------------------------------------------------------------------------
// GET /api/connections/instagram/start
// ---------------------------------------------------------------------------

describe("GET /api/connections/instagram/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockReturnValue("user-1");
    mockAssertInstagramSyncAllowed.mockResolvedValue(undefined);
    process.env.INSTAGRAM_CLIENT_ID = "test-client-id";
    process.env.NUXT_PUBLIC_SITE_ORIGIN = "https://wanderist.app";
  });

  it("propagates a 402 when the plan doesn't allow Instagram sync", async () => {
    mockAssertInstagramSyncAllowed.mockRejectedValue(
      Object.assign(new Error("Plan limit reached"), { statusCode: 402 }),
    );

    await expect(call(startHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 402,
    });
    expect(mockAssertInstagramSyncAllowed).toHaveBeenCalledWith("user-1");
    expect(mockSendRedirect).not.toHaveBeenCalled();
  });

  it("sets the state cookie and redirects to Instagram OAuth", async () => {
    await call(startHandler, makeEvent());

    expect(mockSetCookie).toHaveBeenCalledWith(
      expect.anything(),
      "ig_oauth_state",
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
    expect(mockSendRedirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("instagram.com"),
      302,
    );
  });

  it("sets secure: true only in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    await call(startHandler, makeEvent());

    expect(mockSetCookie).toHaveBeenCalledWith(
      expect.anything(),
      "ig_oauth_state",
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );

    process.env.NODE_ENV = originalNodeEnv;
  });

  it("throws 500 when INSTAGRAM_CLIENT_ID is missing", async () => {
    delete process.env.INSTAGRAM_CLIENT_ID;

    await expect(call(startHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it("throws 500 when NUXT_PUBLIC_SITE_ORIGIN is missing", async () => {
    delete process.env.NUXT_PUBLIC_SITE_ORIGIN;

    await expect(call(startHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireUser.mockImplementation(() => {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    });

    await expect(call(startHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/connections/instagram/callback
// ---------------------------------------------------------------------------

describe("GET /api/connections/instagram/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureUser.mockResolvedValue("user-1");
    mockGetCookie.mockReturnValue("test-state-token");
    mockGetQuery.mockReturnValue({
      code: "auth-code-123",
      state: "test-state-token",
    });
    process.env.INSTAGRAM_CLIENT_ID = "test-client-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "test-client-secret";
    process.env.NUXT_PUBLIC_SITE_ORIGIN = "https://wanderist.app";
    mockExchangeInstagramCode.mockResolvedValue({
      access_token: "short-token",
    });
    mockExchangeForLongLivedToken.mockResolvedValue({
      access_token: "long-token",
    });
    mockFetchInstagramUser.mockResolvedValue({ id: "ig-123" });
    mockEncryptToken.mockReturnValue("encrypted-token");
    mockDbInsertOnConflict.mockResolvedValue(undefined);
  });

  it("stores the encrypted token and redirects to /settings with success query on success", async () => {
    await call(callbackHandler, makeEvent());

    expect(mockEncryptToken).toHaveBeenCalledWith("long-token");
    expect(mockDbInsert).toHaveBeenCalled();
    expect(mockSendRedirect).toHaveBeenCalledWith(
      expect.anything(),
      "/settings?connection=instagram_success#connections",
      302,
    );
  });

  it("throws 400 when the state does not match the cookie", async () => {
    mockGetQuery.mockReturnValue({
      code: "auth-code-123",
      state: "wrong-state",
    });

    await expect(call(callbackHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when the state cookie is missing", async () => {
    mockGetCookie.mockReturnValue(undefined);

    await expect(call(callbackHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("redirects to error path when Instagram returns an error query param", async () => {
    mockGetQuery.mockReturnValue({ error: "access_denied" });

    await call(callbackHandler, makeEvent());

    expect(mockSendRedirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("connection_error=instagram"),
      302,
    );
  });

  it("throws 400 when code is missing from the query", async () => {
    mockGetQuery.mockReturnValue({ state: "test-state-token" });

    await expect(call(callbackHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("deletes the state cookie after validation", async () => {
    await call(callbackHandler, makeEvent());

    expect(mockDeleteCookie).toHaveBeenCalledWith(
      expect.anything(),
      "ig_oauth_state",
    );
  });

  it("includes the userId in the insert values", async () => {
    await call(callbackHandler, makeEvent());

    const calledValues = mockDbInsertValues.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(calledValues?.userId).toBe("user-1");
    expect(calledValues?.provider).toBe("instagram");
    expect(calledValues?.accessToken).toBe("encrypted-token");
  });

  it("persists expiresAt derived from the long-lived token's expires_in", async () => {
    const expiresInSeconds = 5_183_944; // ~60 days
    mockExchangeForLongLivedToken.mockResolvedValue({
      access_token: "long-token",
      token_type: "bearer",
      expires_in: expiresInSeconds,
    });
    const before = Date.now();

    await call(callbackHandler, makeEvent());

    const after = Date.now();
    const calledValues = mockDbInsertValues.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    const expiresAt = calledValues?.expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + expiresInSeconds * 1000,
    );
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      after + expiresInSeconds * 1000,
    );
  });

  it("falls back to a ~60-day expiry when the long-lived response omits expires_in", async () => {
    mockExchangeForLongLivedToken.mockResolvedValue({
      access_token: "long-token",
    });
    const before = Date.now();

    await call(callbackHandler, makeEvent());
    const after = Date.now();

    const calledValues = mockDbInsertValues.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    const expiresAt = calledValues?.expiresAt as Date;
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeInstanceOf(Date);
    // Bounded both sides so lengthening the fallback (e.g. to 600 days) fails
    // this test, not just shortening it.
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + sixtyDaysMs);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + sixtyDaysMs);
  });
});

// ---------------------------------------------------------------------------
// GET /api/connections/instagram (status)
// ---------------------------------------------------------------------------

describe("GET /api/connections/instagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockReturnValue("user-1");
    mockDbSelectLimit.mockResolvedValue([]);
  });

  it("returns { connected: false } when no row exists", async () => {
    const result = await call(statusHandler, makeEvent());

    expect(result).toEqual({ connected: false });
  });

  it("returns { connected: true } when a connection row exists", async () => {
    mockDbSelectLimit.mockResolvedValue([{ id: "row-1" }]);

    const result = await call(statusHandler, makeEvent());

    expect(result).toEqual({ connected: true });
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireUser.mockImplementation(() => {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    });

    await expect(call(statusHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/connections/instagram
// ---------------------------------------------------------------------------

describe("DELETE /api/connections/instagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockReturnValue("user-1");
    mockDbDeleteWhere.mockResolvedValue(undefined);
  });

  it("deletes the connected_accounts row for the user", async () => {
    const result = await call(deleteHandler, makeEvent());

    expect(mockDbDelete).toHaveBeenCalled();
    expect(mockDbDeleteWhere).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireUser.mockImplementation(() => {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    });

    await expect(call(deleteHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("scopes the delete to the authenticated user", async () => {
    mockRequireUser.mockReturnValue("user-specific");

    await call(deleteHandler, makeEvent());

    // The delete was driven through a where() call — ownership scoping was applied.
    expect(mockDbDeleteWhere).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/connections/instagram/import
// ---------------------------------------------------------------------------

describe("POST /api/connections/instagram/import", () => {
  // The neon-http driver has no interactive transactions, so importSinglePhoto
  // now writes sequentially on the base client (issue #200). The mock exposes a
  // `transaction` spy that must stay uncalled — the regression guard.
  //
  // Optional `capturedInserts` records every value object passed to an insert on
  // the import path, so tests can assert on the media row's fields.
  function makeImportDb(capturedInserts?: Record<string, unknown>[]): object {
    if (capturedInserts) {
      mockDbInsertValues.mockImplementation(
        (values: Record<string, unknown>) => {
          capturedInserts.push(values);
          const thenable = Promise.resolve(undefined);
          return Object.assign(thenable, {
            onConflictDoUpdate: mockDbInsertOnConflict,
            returning: mockDbInsertReturning,
          });
        },
      );
    }
    return {
      insert: mockDbInsert,
      delete: mockDbDelete,
      select: mockDbSelect,
      transaction: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureUser.mockResolvedValue("user-1");
    // vi.clearAllMocks() only clears call records (mockClear); it leaves
    // implementations and queued mock*Once entries in place. Reset the mocks a
    // prior test mutates so neither a stale implementation nor an unconsumed
    // `once` (e.g. a test that threw before the connection lookup) bleeds into
    // the next test. Then re-establish the insert default (awaitable +
    // .returning() + .onConflictDoUpdate()) so uncaptured tests still work.
    mockDbInsertValues.mockReset();
    mockDbInsertValues.mockImplementation(() => {
      const thenable = Promise.resolve(undefined);
      return Object.assign(thenable, {
        onConflictDoUpdate: mockDbInsertOnConflict,
        returning: mockDbInsertReturning,
      });
    });
    mockDbInsertReturning.mockReset().mockResolvedValue([{ id: "new-id" }]);
    // The connection lookup (.where().limit()) resolves first and returns the
    // connected account row; every later .limit() (resolveOrCreatePlace) resolves
    // to [] so the import path always inserts a fresh place.
    mockDbSelectLimit.mockReset();
    mockDbSelectLimit.mockResolvedValue([]).mockResolvedValueOnce([
      {
        externalId: "ig-123",
        accessToken: "encrypted-token",
        expiresAt: null,
      },
    ]);
    // Dedupe query uses .where() directly (no .limit) — default to no already-imported IDs.
    mockDbSelectWhere.mockImplementation(() => {
      const thenable = Promise.resolve([] as unknown[]);
      return Object.assign(thenable, { limit: mockDbSelectLimit });
    });
    mockEnsureFreshInstagramToken.mockResolvedValue("long-token");
    mockDecryptToken.mockReturnValue("long-token");
    // clearAllMocks() wipes call records but neither resets implementations nor
    // drains the mock*Once queues, so re-establish the image-pipeline defaults
    // here — otherwise a test that sets a one-off or null return leaks into the
    // next test.
    mockPutMediaBlob.mockReset().mockResolvedValue(undefined);
    mockFetchInstagramImage.mockReset().mockResolvedValue(Buffer.from("img"));
    mockProbeImageDimensions.mockResolvedValue({ width: 1200, height: 800 });
    mockGenerateThumbnail.mockResolvedValue(Buffer.from("thumb"));
    mockFetchInstagramMedia.mockResolvedValue({ data: [] });
    mockFilterGeotaggedMedia.mockReturnValue([]);
    mockAssertInstagramSyncAllowed.mockResolvedValue(undefined);
  });

  it("propagates a 402 when the plan doesn't allow Instagram sync", async () => {
    mockAssertInstagramSyncAllowed.mockRejectedValue(
      Object.assign(new Error("Plan limit reached"), { statusCode: 402 }),
    );

    await expect(call(importHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 402,
    });
    expect(mockAssertInstagramSyncAllowed).toHaveBeenCalledWith("user-1");
    expect(mockFetchInstagramMedia).not.toHaveBeenCalled();
  });

  it("returns { imported: 0, skipped: 0, errors: [], hasMore: false } when no geotagged photos exist", async () => {
    const result = await call(importHandler, makeEvent());

    expect(result).toEqual({
      imported: 0,
      skipped: 0,
      errors: [],
      hasMore: false,
      remaining: 0,
    });
  });

  it("throws 422 when Instagram is not connected", async () => {
    mockDbSelectLimit.mockReset().mockResolvedValue([]);

    await expect(call(importHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it("throws 422 when the connection row has no access token", async () => {
    mockDbSelectLimit.mockReset().mockResolvedValue([{ accessToken: null }]);

    await expect(call(importHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it("refreshes the stored token before calling fetchInstagramMedia", async () => {
    await call(importHandler, makeEvent());

    expect(mockEnsureFreshInstagramToken).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      { externalId: "ig-123", accessToken: "encrypted-token", expiresAt: null },
    );
    expect(mockFetchInstagramMedia).toHaveBeenCalledWith("long-token");
  });

  it("returns 422 when the stored token is expired and cannot be refreshed", async () => {
    mockEnsureFreshInstagramToken.mockRejectedValue(
      new MockInstagramTokenExpiredError("expired"),
    );

    await expect(call(importHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockFetchInstagramMedia).not.toHaveBeenCalled();
  });

  it("calls fetchInstagramImage for each new geotagged item", async () => {
    const geotaggedItem = {
      id: "ig-media-1",
      media_type: "IMAGE",
      media_url: "https://cdn.instagram.com/photo.jpg",
      timestamp: "2024-01-01T00:00:00Z",
      permalink: "https://www.instagram.com/p/abc/",
      location: { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
    };
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedItem]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockGetDb.mockReturnValue(makeImportDb());

    await call(importHandler, makeEvent());

    expect(mockFetchInstagramImage).toHaveBeenCalledWith(
      "https://cdn.instagram.com/photo.jpg",
    );
  });

  const geotaggedPhoto = {
    id: "ig-media-thumb",
    media_type: "IMAGE",
    media_url: "https://cdn.instagram.com/photo.jpg",
    timestamp: "2024-01-01T00:00:00Z",
    permalink: "https://www.instagram.com/p/abc/",
    location: { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
  };

  it("probes dimensions and stores original + thumbnail blobs for each imported photo", async () => {
    const imageBuffer = Buffer.from("real-image-bytes");
    const thumbnailBuffer = Buffer.from("thumb");
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(imageBuffer);
    mockGenerateThumbnail.mockResolvedValue(thumbnailBuffer);
    mockGetDb.mockReturnValue(makeImportDb());

    await call(importHandler, makeEvent());

    expect(mockProbeImageDimensions).toHaveBeenCalledWith(imageBuffer);
    expect(mockGenerateThumbnail).toHaveBeenCalledWith(imageBuffer);
    // storeMediaBlobs writes the original first, then the thumbnail under the
    // original key's `-thumb` suffix. Deriving the expected thumbnail key from
    // the actual original key pins the pairing (not two independent matchers).
    expect(mockPutMediaBlob).toHaveBeenCalledTimes(2);
    const originalKey = mockPutMediaBlob.mock.calls[0][0] as string;
    expect(originalKey).toMatch(/^user-1\//);
    expect(mockPutMediaBlob.mock.calls[0]).toEqual([
      originalKey,
      imageBuffer,
      "image/jpeg",
    ]);
    expect(mockPutMediaBlob.mock.calls[1]).toEqual([
      `${originalKey}-thumb`,
      thumbnailBuffer,
      "image/jpeg",
    ]);
  });

  it("records the probed width/height on the imported media row", async () => {
    const capturedInserts: Record<string, unknown>[] = [];
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockGetDb.mockReturnValue(makeImportDb(capturedInserts));

    await call(importHandler, makeEvent());

    const mediaInsert = capturedInserts.find((row) => "sourceId" in row);
    expect(mediaInsert).toMatchObject({
      width: 1200,
      height: 800,
      source: "instagram",
    });
    // The media row (its unique index is the idempotency guard) must be inserted
    // before the entry, so a concurrent race loses at the media insert with
    // nothing else written. Reordering back to entry-first would silently
    // reintroduce orphaned entries on a race.
    const mediaIndex = capturedInserts.findIndex((row) => "sourceId" in row);
    const entryIndex = capturedInserts.findIndex((row) => "occurredAt" in row);
    expect(mediaIndex).toBeLessThan(entryIndex);
  });

  it("still counts the photo as imported when the thumbnail blob store fails", async () => {
    // Rows are committed before storeMediaBlobs runs, so a thumbnail store
    // rejection must degrade to a missing thumbnail — never a miscounted
    // import for a photo that is already in the DB and visible in the UI.
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockPutMediaBlob
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("blob store down"));
    mockGetDb.mockReturnValue(makeImportDb());

    const result = await call(importHandler, makeEvent());

    expect(result).toMatchObject({ imported: 1, errors: [] });
    // Both stores were attempted — the failure branch actually ran.
    expect(mockPutMediaBlob).toHaveBeenCalledTimes(2);
  });

  it("rolls back the committed rows and reports an error when the original blob store fails", async () => {
    // The original store runs after the rows commit. A failure there would leave
    // a committed media row whose URL points at a blob that was never written,
    // and (because source_id is in the table) the item would be skipped forever.
    // So the rows are rolled back — freeing source_id for a retry — and the
    // failure surfaces as a per-item error rather than a silent success.
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockPutMediaBlob.mockRejectedValueOnce(new Error("blob store down"));
    const importDb = makeImportDb();
    mockGetDb.mockReturnValue(importDb);

    const result = (await call(importHandler, makeEvent())) as {
      imported: number;
      errors: string[];
    };

    expect(result.imported).toBe(0);
    expect(result.errors[0]).toContain("ig-media-thumb");
    // Rollback removed the entry and media rows so the next run can retry.
    expect(mockDbDelete).toHaveBeenNthCalledWith(1, entries);
    expect(mockDbDelete).toHaveBeenNthCalledWith(2, media);
  });

  it("still imports the original with null dimensions when the image can't be processed", async () => {
    const capturedInserts: Record<string, unknown>[] = [];
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockProbeImageDimensions.mockResolvedValue(null);
    mockGenerateThumbnail.mockResolvedValue(null);
    mockGetDb.mockReturnValue(makeImportDb(capturedInserts));

    const result = await call(importHandler, makeEvent());

    expect(result).toMatchObject({ imported: 1, errors: [] });
    const mediaInsert = capturedInserts.find((row) => "sourceId" in row);
    expect(mediaInsert).toMatchObject({ width: null, height: null });
    // No thumbnail generated → only the original blob is stored.
    expect(mockPutMediaBlob).toHaveBeenCalledTimes(1);
  });

  it("skips items already imported and increments skipped count", async () => {
    const alreadyImportedItem = {
      id: "ig-media-already",
      media_type: "IMAGE",
      media_url: "https://cdn.instagram.com/old.jpg",
      timestamp: "2024-01-01T00:00:00Z",
      permalink: "https://www.instagram.com/p/old/",
      location: { name: "Rome", latitude: 41.9028, longitude: 12.4964 },
    };
    const newItem = {
      id: "ig-media-new",
      media_type: "IMAGE",
      media_url: "https://cdn.instagram.com/new.jpg",
      timestamp: "2024-06-01T00:00:00Z",
      permalink: "https://www.instagram.com/p/new/",
      location: { name: "Madrid", latitude: 40.4168, longitude: -3.7038 },
    };

    mockFilterGeotaggedMedia.mockReturnValue([alreadyImportedItem, newItem]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));

    // Dedupe query returns the already-imported source_id.
    mockDbSelectWhere.mockImplementationOnce(() => {
      // First call: connection lookup — needs .limit()
      const thenable = Promise.resolve([] as unknown[]);
      return Object.assign(thenable, { limit: mockDbSelectLimit });
    });
    mockDbSelectWhere.mockImplementationOnce(() => {
      // Second call: dedupe query — awaited directly, returns existing sourceId.
      return Promise.resolve([{ sourceId: "ig-media-already" }]);
    });

    mockGetDb.mockReturnValue(makeImportDb());

    const result = await call(importHandler, makeEvent());

    expect(result).toMatchObject({ imported: 1, skipped: 1, errors: [] });
    expect(mockFetchInstagramImage).toHaveBeenCalledTimes(1);
    expect(mockFetchInstagramImage).toHaveBeenCalledWith(
      "https://cdn.instagram.com/new.jpg",
    );
  });

  it("re-import of all already-imported items returns 0 imported", async () => {
    const item = {
      id: "ig-media-1",
      media_type: "IMAGE",
      media_url: "https://cdn.instagram.com/photo.jpg",
      timestamp: "2024-01-01T00:00:00Z",
      permalink: "https://www.instagram.com/p/abc/",
      location: { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
    };
    mockFilterGeotaggedMedia.mockReturnValue([item]);

    mockDbSelectWhere.mockImplementationOnce(() => {
      const thenable = Promise.resolve([] as unknown[]);
      return Object.assign(thenable, { limit: mockDbSelectLimit });
    });
    mockDbSelectWhere.mockImplementationOnce(() =>
      Promise.resolve([{ sourceId: "ig-media-1" }]),
    );

    const result = await call(importHandler, makeEvent());

    expect(result).toEqual({
      imported: 0,
      skipped: 1,
      errors: [],
      hasMore: false,
      remaining: 0,
    });
    expect(mockFetchInstagramImage).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockEnsureUser.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
    );

    await expect(call(importHandler, makeEvent())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("scopes the connection lookup and dedupe query to the authenticated user", async () => {
    // Provide a geotagged item so the dedupe query runs (it is skipped when
    // the media list is empty).
    const item = {
      id: "ig-media-scope-test",
      media_type: "IMAGE",
      media_url: "https://cdn.instagram.com/photo.jpg",
      timestamp: "2024-01-01T00:00:00Z",
      permalink: "https://www.instagram.com/p/abc/",
      location: { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
    };
    mockFilterGeotaggedMedia.mockReturnValue([item]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockGetDb.mockReturnValue(makeImportDb());

    await call(importHandler, makeEvent());

    // Three select chains pass through where(): the user-scoped connection
    // lookup, the user-scoped dedupe query, and the per-photo place lookup.
    expect(mockDbSelectWhere).toHaveBeenCalledTimes(3);
  });

  function makeGeotaggedItem(id: string): Record<string, unknown> {
    return {
      id,
      media_type: "IMAGE",
      media_url: `https://cdn.instagram.com/${id}.jpg`,
      timestamp: "2024-01-01T00:00:00Z",
      permalink: `https://www.instagram.com/p/${id}/`,
      location: { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
    };
  }

  it("imports at most INSTAGRAM_IMPORT_MAX_ITEMS_PER_RUN new photos and reports hasMore", async () => {
    // Cap is mocked to 2; three new geotagged items overflow it.
    mockFilterGeotaggedMedia.mockReturnValue([
      makeGeotaggedItem("ig-a"),
      makeGeotaggedItem("ig-b"),
      makeGeotaggedItem("ig-c"),
    ]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockGetDb.mockReturnValue(makeImportDb());

    const result = await call(importHandler, makeEvent());

    expect(result).toEqual({
      imported: 2,
      skipped: 0,
      errors: [],
      hasMore: true,
      remaining: 1,
    });
    // The third item is deferred to the next run: its image is never fetched.
    expect(mockFetchInstagramImage).toHaveBeenCalledTimes(2);
  });

  it("reports hasMore false when the pending items fit within one run", async () => {
    mockFilterGeotaggedMedia.mockReturnValue([
      makeGeotaggedItem("ig-a"),
      makeGeotaggedItem("ig-b"),
    ]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockGetDb.mockReturnValue(makeImportDb());

    const result = await call(importHandler, makeEvent());

    expect(result).toEqual({
      imported: 2,
      skipped: 0,
      errors: [],
      hasMore: false,
      remaining: 0,
    });
    expect(mockFetchInstagramImage).toHaveBeenCalledTimes(2);
  });

  it("excludes already-imported items before applying the per-run cap", async () => {
    // 2 already-imported + 3 new; the cap of 2 must slice the *pending* items,
    // not the raw geotagged list — so 2 import, 2 are skipped, 1 remains.
    mockFilterGeotaggedMedia.mockReturnValue([
      makeGeotaggedItem("ig-old-1"),
      makeGeotaggedItem("ig-old-2"),
      makeGeotaggedItem("ig-new-1"),
      makeGeotaggedItem("ig-new-2"),
      makeGeotaggedItem("ig-new-3"),
    ]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockGetDb.mockReturnValue(makeImportDb());

    mockDbSelectWhere.mockImplementationOnce(() => {
      // Connection lookup — needs .limit().
      const thenable = Promise.resolve([] as unknown[]);
      return Object.assign(thenable, { limit: mockDbSelectLimit });
    });
    mockDbSelectWhere.mockImplementationOnce(() =>
      // Dedupe query — two ids already imported.
      Promise.resolve([{ sourceId: "ig-old-1" }, { sourceId: "ig-old-2" }]),
    );

    const result = await call(importHandler, makeEvent());

    expect(result).toEqual({
      imported: 2,
      skipped: 2,
      errors: [],
      hasMore: true,
      remaining: 1,
    });
    expect(mockFetchInstagramImage).toHaveBeenCalledTimes(2);
  });

  it("does not advertise a resume when the whole batch fails", async () => {
    // Three new items overflow the cap of 2, but every import fails, so no
    // source_id is written; re-running would re-slice the same stuck items.
    // hasMore must be false to avoid an endless retry loop.
    mockFilterGeotaggedMedia.mockReturnValue([
      makeGeotaggedItem("ig-a"),
      makeGeotaggedItem("ig-b"),
      makeGeotaggedItem("ig-c"),
    ]);
    mockFetchInstagramImage.mockRejectedValue(new Error("CDN 404"));
    mockGetDb.mockReturnValue(makeImportDb());

    const result = (await call(importHandler, makeEvent())) as {
      imported: number;
      hasMore: boolean;
      errors: string[];
    };

    expect(result.imported).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.errors).toHaveLength(2);
    // 3 pending, 0 imported: all three (2 failed + 1 untouched) still remain,
    // and the UI's "N still pending" copy is computed from this value.
    expect(result.remaining).toBe(3);
  });

  it("still advertises a resume when part of the batch fails but one succeeds", async () => {
    // Cap 2; batch is [ig-a, ig-b]. ig-a's image fetch fails, ig-b succeeds, so
    // progress was made and a third item still waits — hasMore stays true.
    mockFilterGeotaggedMedia.mockReturnValue([
      makeGeotaggedItem("ig-a"),
      makeGeotaggedItem("ig-b"),
      makeGeotaggedItem("ig-c"),
    ]);
    mockFetchInstagramImage
      .mockRejectedValueOnce(new Error("CDN 404"))
      .mockResolvedValue(Buffer.from("img"));
    mockGetDb.mockReturnValue(makeImportDb());

    const result = (await call(importHandler, makeEvent())) as {
      imported: number;
      hasMore: boolean;
      remaining: number;
      errors: string[];
    };

    expect(result.imported).toBe(1);
    expect(result.hasMore).toBe(true);
    // 3 pending, 1 imported; the failed item plus the untouched one both remain.
    expect(result.remaining).toBe(2);
    expect(result.errors).toHaveLength(1);
  });

  it("stops mid-batch when the wall-time budget is spent", async () => {
    vi.useFakeTimers();
    try {
      mockFilterGeotaggedMedia.mockReturnValue([
        makeGeotaggedItem("ig-a"),
        makeGeotaggedItem("ig-b"),
      ]);
      // The first import overruns the (mocked 60s) budget, so the loop must
      // break before starting the second item — proving the time budget, not
      // just the count cap, bounds the run.
      mockFetchInstagramImage.mockImplementation(() => {
        vi.advanceTimersByTime(61000);
        return Promise.resolve(Buffer.from("img"));
      });
      mockGetDb.mockReturnValue(makeImportDb());

      const result = (await call(importHandler, makeEvent())) as {
        imported: number;
        hasMore: boolean;
        remaining: number;
      };

      expect(mockFetchInstagramImage).toHaveBeenCalledTimes(1);
      expect(result.imported).toBe(1);
      expect(result.hasMore).toBe(true);
      expect(result.remaining).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still attempts one item when the budget was spent before the loop began", async () => {
    vi.useFakeTimers();
    try {
      mockFilterGeotaggedMedia.mockReturnValue([
        makeGeotaggedItem("ig-a"),
        makeGeotaggedItem("ig-b"),
      ]);
      // The page walk itself consumes the whole budget, so the loop enters
      // already past the deadline. The forward-progress guard must still attempt
      // one item — otherwise the user loops forever on "run again" with nothing
      // ever imported.
      mockFetchInstagramMedia.mockImplementation(() => {
        vi.advanceTimersByTime(61000);
        return Promise.resolve({ data: [] });
      });
      mockGetDb.mockReturnValue(makeImportDb());

      const result = (await call(importHandler, makeEvent())) as {
        imported: number;
        hasMore: boolean;
        remaining: number;
      };

      // Exactly one item attempted (and imported); the second is deferred.
      expect(mockFetchInstagramImage).toHaveBeenCalledTimes(1);
      expect(result.imported).toBe(1);
      expect(result.hasMore).toBe(true);
      expect(result.remaining).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes the import rows without opening a transaction (issue #200)", async () => {
    // The app's drizzle client uses the neon-http driver, which throws on
    // database.transaction(). Every import row must be written sequentially on
    // the base client instead; a stray transaction() call 500s the whole run.
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    const importDb = makeImportDb();
    mockGetDb.mockReturnValue(importDb);

    const result = await call(importHandler, makeEvent());

    expect(result).toMatchObject({ imported: 1, errors: [] });
    expect(
      (importDb as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).not.toHaveBeenCalled();
    // media, entry, and entryPhotos are all inserted on the base client.
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it("rolls back the committed media row when a later write fails", async () => {
    // With no interactive transaction, a failure after the media row commits is
    // undone by hand: the media row (inserted first as the unique-index guard)
    // must be deleted so a failed import leaves no orphaned media.
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    // A place already exists (no place insert), so the returning() sequence is
    // media (resolves) then entry (rejects) — the entry write fails after media.
    mockDbSelectLimit
      .mockReset()
      .mockResolvedValueOnce([
        {
          externalId: "ig-123",
          accessToken: "encrypted-token",
          expiresAt: null,
        },
      ])
      .mockResolvedValue([{ id: "existing-place" }]);
    mockDbInsertReturning
      .mockReset()
      .mockResolvedValueOnce([{ id: "media-id" }])
      .mockRejectedValueOnce(new Error("entry write failed"));
    const importDb = makeImportDb();
    mockGetDb.mockReturnValue(importDb);

    const result = (await call(importHandler, makeEvent())) as {
      imported: number;
      errors: string[];
    };

    expect(result.imported).toBe(0);
    expect(result.errors[0]).toContain("ig-media-thumb");
    // Rollback deletes the entry first, then the media row (the media row's
    // unique index is the idempotency guard, so leaving it would make the item
    // unimportable forever).
    expect(mockDbDelete).toHaveBeenCalledTimes(2);
    expect(mockDbDelete).toHaveBeenNthCalledWith(1, entries);
    expect(mockDbDelete).toHaveBeenNthCalledWith(2, media);
    // Blobs are only written after all rows commit, so a failed import never
    // reaches the blob store.
    expect(mockPutMediaBlob).not.toHaveBeenCalled();
  });

  it("still deletes the media row when the rollback entry delete fails", async () => {
    // deleteQuietly isolates each rollback delete: a throwing entry delete must
    // not suppress the media delete (the media row's unique index is the guard,
    // so leaving it makes the item unimportable forever).
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockDbSelectLimit
      .mockReset()
      .mockResolvedValueOnce([
        {
          externalId: "ig-123",
          accessToken: "encrypted-token",
          expiresAt: null,
        },
      ])
      .mockResolvedValue([{ id: "existing-place" }]);
    mockDbInsertReturning
      .mockReset()
      .mockResolvedValueOnce([{ id: "media-id" }])
      .mockRejectedValueOnce(new Error("entry write failed"));
    const importDb = makeImportDb();
    // First rollback delete (entries) throws; the second (media) must still run.
    mockDbDelete
      .mockReturnValueOnce({
        where: vi.fn().mockRejectedValue(new Error("entry delete failed")),
      })
      .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockGetDb.mockReturnValue(importDb);

    const result = (await call(importHandler, makeEvent())) as {
      imported: number;
    };

    expect(result.imported).toBe(0);
    expect(mockDbDelete).toHaveBeenNthCalledWith(1, entries);
    expect(mockDbDelete).toHaveBeenNthCalledWith(2, media);
  });

  it("writes nothing to roll back when the media insert loses a race", async () => {
    // The media insert carries the unique index and runs first. When a concurrent
    // import already wrote the same (user, source, source_id), this insert fails
    // before any other row exists — so no rollback delete should run.
    mockFilterGeotaggedMedia.mockReturnValue([geotaggedPhoto]);
    mockFetchInstagramImage.mockResolvedValue(Buffer.from("img"));
    mockDbInsertReturning
      .mockReset()
      .mockRejectedValueOnce(new Error("duplicate key value"));
    const importDb = makeImportDb();
    mockGetDb.mockReturnValue(importDb);

    const result = (await call(importHandler, makeEvent())) as {
      imported: number;
      errors: string[];
    };

    expect(result.imported).toBe(0);
    expect(result.errors[0]).toContain("ig-media-thumb");
    expect(mockDbDelete).not.toHaveBeenCalled();
    expect(mockPutMediaBlob).not.toHaveBeenCalled();
  });
});
