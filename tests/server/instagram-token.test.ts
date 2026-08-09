/**
 * Unit tests for server/utils/instagramToken.ts — the Instagram long-lived
 * token refresh + on-use "self-heal" boundary.
 *
 * The pure predicates are tested directly. ensureFreshInstagramToken and
 * persistRefreshedInstagramToken are exercised against a mocked drizzle db
 * chain, with the Instagram client and token crypto mocked at their module
 * boundaries — no network or database access. Same pattern as
 * tests/server/purge-accounts.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRefreshLongLivedToken,
  mockEncryptToken,
  mockDecryptToken,
  MockInstagramApiError,
} = vi.hoisted(() => ({
  mockRefreshLongLivedToken: vi.fn(),
  mockEncryptToken: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  mockDecryptToken: vi.fn((ciphertext: string) =>
    ciphertext.replace(/^encrypted:/, ""),
  ),
  MockInstagramApiError: class extends Error {
    status: number;
    metaError?: { type?: string; code?: number; subcode?: number };
    constructor(
      message: string,
      status: number,
      metaError?: { type?: string; code?: number; subcode?: number },
    ) {
      super(message);
      this.status = status;
      this.metaError = metaError;
    }
  },
}));

// Only the network-touching surface is mocked; the classification constant
// META_TOKEN_REVOKED_CODE comes through from the real module so this suite
// fails if that value ever drifts.
vi.mock("../../server/utils/instagramClient", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/utils/instagramClient")
  >()),
  refreshLongLivedToken: mockRefreshLongLivedToken,
  InstagramApiError: MockInstagramApiError,
}));

// A genuine Meta token revocation: an OAuthException with code 190 (subcode
// narrows the exact cause — 463 is "session expired"). Classified as
// unrecoverable alongside a bare 401.
function makeRevocationError(message = "session expired") {
  return new MockInstagramApiError(message, 400, {
    type: "OAuthException",
    code: 190,
    subcode: 463,
  });
}

vi.mock("../../server/utils/tokenCrypto", () => ({
  encryptToken: mockEncryptToken,
  decryptToken: mockDecryptToken,
}));

const {
  INSTAGRAM_REFRESH_THRESHOLD_DAYS,
  INSTAGRAM_LONG_LIVED_TOKEN_DAYS,
  InstagramTokenExpiredError,
  isInstagramTokenNearExpiry,
  isInstagramTokenExpired,
  isUnrecoverableRefreshError,
  isUnclassifiedRefresh400,
  expiryFromResponse,
  persistRefreshedInstagramToken,
  markInstagramTokenExpired,
  ensureFreshInstagramToken,
} = await import("../../server/utils/instagramToken");
import { MS_PER_DAY } from "../../server/utils/accountLifecycle";
import { PgDialect } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Pure predicates
// ---------------------------------------------------------------------------

describe("isInstagramTokenNearExpiry", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  it("is true when the token expires within the threshold window", () => {
    const expiresAt = new Date(
      now.getTime() + (INSTAGRAM_REFRESH_THRESHOLD_DAYS - 1) * MS_PER_DAY,
    );
    expect(isInstagramTokenNearExpiry(expiresAt, now)).toBe(true);
  });

  it("is false when the token has more than the threshold left", () => {
    const expiresAt = new Date(
      now.getTime() + (INSTAGRAM_REFRESH_THRESHOLD_DAYS + 1) * MS_PER_DAY,
    );
    expect(isInstagramTokenNearExpiry(expiresAt, now)).toBe(false);
  });

  it("is true for a null expiry so the next use backfills one", () => {
    expect(isInstagramTokenNearExpiry(null, now)).toBe(true);
  });
});

describe("isInstagramTokenExpired", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  it("is true once the expiry is at or before now", () => {
    expect(isInstagramTokenExpired(new Date(now.getTime() - 1), now)).toBe(
      true,
    );
  });

  it("is false while the expiry is still in the future", () => {
    expect(
      isInstagramTokenExpired(new Date(now.getTime() + MS_PER_DAY), now),
    ).toBe(false);
  });

  it("is false for a null expiry — unknown is not treated as dead", () => {
    expect(isInstagramTokenExpired(null, now)).toBe(false);
  });
});

describe("expiryFromResponse", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  it("adds expires_in seconds to now", () => {
    const expiry = expiryFromResponse(
      { access_token: "t", token_type: "bearer", expires_in: 3600 },
      now,
    );
    expect(expiry).toEqual(new Date(now.getTime() + 3600 * 1000));
  });

  it("falls back to the 60-day lifetime when expires_in is missing", () => {
    const expiry = expiryFromResponse(
      { access_token: "t", token_type: "bearer" },
      now,
    );
    expect(expiry).toEqual(
      new Date(now.getTime() + INSTAGRAM_LONG_LIVED_TOKEN_DAYS * MS_PER_DAY),
    );
  });
});

describe("isUnrecoverableRefreshError", () => {
  it("is true for a genuine revocation — OAuthException code 190 on a 400", () => {
    expect(isUnrecoverableRefreshError(makeRevocationError())).toBe(true);
  });

  it("is true for code 190 regardless of the accompanying type", () => {
    // The code alone identifies a dead token; a missing or variant type must
    // not veto a real revocation.
    expect(
      isUnrecoverableRefreshError(
        new MockInstagramApiError("revoked", 400, { code: 190, subcode: 458 }),
      ),
    ).toBe(true);
    expect(
      isUnrecoverableRefreshError(
        new MockInstagramApiError("revoked", 400, {
          type: "IGApiException",
          code: 190,
        }),
      ),
    ).toBe(true);
  });

  it("is false for a 400 that is not an OAuthException code-190 revocation", () => {
    // A transient/ambiguous 400 must not disconnect a still-valid connection.
    expect(
      isUnrecoverableRefreshError(
        new MockInstagramApiError("bad request", 400),
      ),
    ).toBe(false);
    expect(
      isUnrecoverableRefreshError(
        new MockInstagramApiError("app rate limit", 400, {
          type: "OAuthException",
          code: 4,
        }),
      ),
    ).toBe(false);
  });

  it("is true for a bare 401 — an unambiguous auth rejection, no body needed", () => {
    expect(
      isUnrecoverableRefreshError(
        new MockInstagramApiError("unauthorized", 401),
      ),
    ).toBe(true);
  });

  it("is false for a transient 429 and for non-API errors", () => {
    expect(
      isUnrecoverableRefreshError(new MockInstagramApiError("rate", 429)),
    ).toBe(false);
    expect(isUnrecoverableRefreshError(new Error("network"))).toBe(false);
  });

  it("is false for a 5xx that happens to echo code 190 — only a 400 revokes", () => {
    // A code 190 in a transient server-error response must not disconnect a
    // still-valid connection; the code-190 rule is gated on a 400.
    expect(
      isUnrecoverableRefreshError(
        new MockInstagramApiError("upstream", 503, { code: 190 }),
      ),
    ).toBe(false);
  });

  it("is false for a 400 whose Meta detail parsed a type but no code", () => {
    // The drift case: a partially-parsed envelope missing the one field
    // classification depends on must not be read as a revocation.
    expect(
      isUnrecoverableRefreshError(
        new MockInstagramApiError("drifted", 400, { type: "OAuthException" }),
      ),
    ).toBe(false);
  });
});

describe("isUnclassifiedRefresh400", () => {
  it("is true for a 400 with no Meta detail at all", () => {
    expect(
      isUnclassifiedRefresh400(new MockInstagramApiError("bad request", 400)),
    ).toBe(true);
  });

  it("is true for a 400 whose detail has a type but no code (partial parse)", () => {
    // The exact drift finding-1 exists to catch: code renamed / retyped so it
    // parses to undefined while other fields survive.
    expect(
      isUnclassifiedRefresh400(
        new MockInstagramApiError("drifted", 400, {
          type: "OAuthException",
          subcode: 463,
        }),
      ),
    ).toBe(true);
  });

  it("is false when a numeric code is present — that is classifiable", () => {
    expect(
      isUnclassifiedRefresh400(
        new MockInstagramApiError("rate", 400, { code: 4 }),
      ),
    ).toBe(false);
    expect(isUnclassifiedRefresh400(makeRevocationError())).toBe(false);
  });

  it("is false for a non-400 or a non-API error", () => {
    expect(
      isUnclassifiedRefresh400(new MockInstagramApiError("server", 503)),
    ).toBe(false);
    expect(isUnclassifiedRefresh400(new Error("network"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB-touching helpers — mocked drizzle chain
// ---------------------------------------------------------------------------

function makeUpdatableDb() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return {
    db: { update } as unknown as Parameters<
      typeof persistRefreshedInstagramToken
    >[0],
    update,
    set,
    where,
  };
}

describe("persistRefreshedInstagramToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the encrypted new token + derived expiry scoped to the account", async () => {
    const { db, update, set, where } = makeUpdatableDb();
    const now = new Date("2026-08-01T00:00:00.000Z");

    const expiresAt = await persistRefreshedInstagramToken(
      db,
      "ig-A",
      { access_token: "fresh-token", token_type: "bearer", expires_in: 5000 },
      now,
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      accessToken: "encrypted:fresh-token",
      expiresAt: new Date(now.getTime() + 5000 * 1000),
    });
    expect(where).toHaveBeenCalledTimes(1);
    expect(expiresAt).toEqual(new Date(now.getTime() + 5000 * 1000));
  });

  it("persists a 60-day fallback expiry when the response omits expires_in", async () => {
    const { db, set } = makeUpdatableDb();
    const now = new Date("2026-08-01T00:00:00.000Z");

    const expiresAt = await persistRefreshedInstagramToken(
      db,
      "ig-A",
      { access_token: "fresh-token", token_type: "bearer" },
      now,
    );

    const sixtyDays = new Date(
      now.getTime() + INSTAGRAM_LONG_LIVED_TOKEN_DAYS * MS_PER_DAY,
    );
    expect(set).toHaveBeenCalledWith({
      accessToken: "encrypted:fresh-token",
      expiresAt: sixtyDays,
    });
    expect(expiresAt).toEqual(sixtyDays);
  });

  it("scopes the update to (provider, external_id), not the user", async () => {
    const { db, where } = makeUpdatableDb();

    await persistRefreshedInstagramToken(
      db,
      "ig-A",
      { access_token: "fresh-token", token_type: "bearer", expires_in: 5000 },
      new Date("2026-08-01T00:00:00.000Z"),
    );

    const condition = where.mock.calls[0]?.[0];
    const { sql, params } = new PgDialect().sqlToQuery(condition as never);
    expect(sql).toContain('"provider"');
    expect(sql).toContain('"external_id"');
    expect(sql).not.toContain('"user_id"');
    expect(params).toContain("ig-A");
  });
});

describe("markInstagramTokenExpired", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stamps the row's expiry as now, scoped to (provider, external_id)", async () => {
    const { db, set, where } = makeUpdatableDb();
    const now = new Date("2026-08-01T00:00:00.000Z");

    await markInstagramTokenExpired(db, "ig-A", now);

    expect(set).toHaveBeenCalledWith({ expiresAt: now });
    const { sql, params } = new PgDialect().sqlToQuery(
      where.mock.calls[0]?.[0] as never,
    );
    expect(sql).toContain('"external_id"');
    expect(params).toContain("ig-A");
  });
});

describe("ensureFreshInstagramToken", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current token without refreshing when not near expiry", async () => {
    const { db, update } = makeUpdatableDb();
    const expiresAt = new Date(
      now.getTime() + (INSTAGRAM_REFRESH_THRESHOLD_DAYS + 5) * MS_PER_DAY,
    );

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      { externalId: "ig-A", accessToken: "encrypted:current-token", expiresAt },
      now,
    );

    expect(token).toBe("current-token");
    expect(mockRefreshLongLivedToken).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("refreshes, persists, and returns the new token when near expiry", async () => {
    const { db, update } = makeUpdatableDb();
    const expiresAt = new Date(
      now.getTime() + (INSTAGRAM_REFRESH_THRESHOLD_DAYS - 1) * MS_PER_DAY,
    );
    mockRefreshLongLivedToken.mockResolvedValue({
      access_token: "new-token",
      token_type: "bearer",
      expires_in: 5_183_944,
    });

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      { externalId: "ig-A", accessToken: "encrypted:old-token", expiresAt },
      now,
    );

    expect(mockRefreshLongLivedToken).toHaveBeenCalledWith({
      accessToken: "old-token",
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(token).toBe("new-token");
  });

  it("refreshes a null-expiry (pre-refresh) row to backfill its expiry", async () => {
    const { db, update } = makeUpdatableDb();
    mockRefreshLongLivedToken.mockResolvedValue({
      access_token: "new-token",
      token_type: "bearer",
      expires_in: 5_183_944,
    });

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      {
        externalId: "ig-A",
        accessToken: "encrypted:old-token",
        expiresAt: null,
      },
      now,
    );

    expect(mockRefreshLongLivedToken).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(token).toBe("new-token");
  });

  it("logs and falls back to the current token when refresh fails but it has not expired", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, update } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() + 2 * MS_PER_DAY);
    mockRefreshLongLivedToken.mockRejectedValue(new Error("429 rate limited"));

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      { externalId: "ig-A", accessToken: "encrypted:still-valid", expiresAt },
      now,
    );

    expect(token).toBe("still-valid");
    expect(update).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("throws InstagramTokenExpiredError when refresh fails and the token is already expired", async () => {
    const { db } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() - MS_PER_DAY);
    mockRefreshLongLivedToken.mockRejectedValue(new Error("400 expired"));

    await expect(
      ensureFreshInstagramToken(
        db,
        "user-1",
        { externalId: "ig-A", accessToken: "encrypted:dead", expiresAt },
        now,
      ),
    ).rejects.toBeInstanceOf(InstagramTokenExpiredError);
  });

  it("throws InstagramTokenExpiredError on a genuine revocation even when the stored expiry is unknown", async () => {
    const { db } = makeUpdatableDb();
    mockRefreshLongLivedToken.mockRejectedValue(makeRevocationError());

    await expect(
      ensureFreshInstagramToken(
        db,
        "user-1",
        { externalId: "ig-A", accessToken: "encrypted:dead", expiresAt: null },
        now,
      ),
    ).rejects.toBeInstanceOf(InstagramTokenExpiredError);
  });

  it("stamps the row expired on a genuine revocation so repeated imports stop re-hitting Instagram", async () => {
    const { db, update, set } = makeUpdatableDb();
    mockRefreshLongLivedToken.mockRejectedValue(makeRevocationError());

    await expect(
      ensureFreshInstagramToken(
        db,
        "user-1",
        { externalId: "ig-A", accessToken: "encrypted:dead", expiresAt: null },
        now,
      ),
    ).rejects.toBeInstanceOf(InstagramTokenExpiredError);
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ expiresAt: now });
  });

  it("throws InstagramTokenExpiredError and stamps the row on a bare 401", async () => {
    const { db, update, set } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() + 2 * MS_PER_DAY);
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("unauthorized", 401),
    );

    await expect(
      ensureFreshInstagramToken(
        db,
        "user-1",
        { externalId: "ig-A", accessToken: "encrypted:dead", expiresAt },
        now,
      ),
    ).rejects.toBeInstanceOf(InstagramTokenExpiredError);
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ expiresAt: now });
  });

  it("falls back to the current token on a non-revocation 400 while the token is still valid", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, update } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() + 2 * MS_PER_DAY);
    // A 400 that is NOT an OAuthException code-190 revocation — must not
    // disconnect a still-valid connection, and must not stamp the row expired.
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("transient bad request", 400),
    );

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      { externalId: "ig-A", accessToken: "encrypted:still-valid", expiresAt },
      now,
    );

    expect(token).toBe("still-valid");
    expect(update).not.toHaveBeenCalled();
    // Assert the specific drift line fired, not merely "some warn" — a weaker
    // check would pass even if the drift alarm were deleted.
    const warned = consoleSpy.mock.calls.some((call) =>
      String(call[0]).includes("drift"),
    );
    expect(warned).toBe(true);
    consoleSpy.mockRestore();
  });

  it("logs a drift alarm for a 400 with no parseable Meta detail", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() + 2 * MS_PER_DAY);
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("no meta body", 400),
    );

    await ensureFreshInstagramToken(
      db,
      "user-1",
      { externalId: "ig-A", accessToken: "encrypted:still-valid", expiresAt },
      now,
    );

    const warned = consoleSpy.mock.calls.some((call) =>
      String(call[0]).includes("drift"),
    );
    expect(warned).toBe(true);
    consoleSpy.mockRestore();
  });

  it("does not log a drift alarm for a classified transient 400 (code 4)", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() + 2 * MS_PER_DAY);
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("app rate limit", 400, { code: 4 }),
    );

    await ensureFreshInstagramToken(
      db,
      "user-1",
      { externalId: "ig-A", accessToken: "encrypted:still-valid", expiresAt },
      now,
    );

    const warned = consoleSpy.mock.calls.some((call) =>
      String(call[0]).includes("drift"),
    );
    expect(warned).toBe(false);
    consoleSpy.mockRestore();
  });

  it("throws InstagramTokenExpiredError on a non-revocation 400 once the stored expiry is already past, and still logs the drift alarm", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, update } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() - MS_PER_DAY);
    // Even a transient 400 is unrecoverable when our own stored expiry has
    // already lapsed — but the row is not re-stamped (only revocation stamps).
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("transient bad request", 400),
    );

    await expect(
      ensureFreshInstagramToken(
        db,
        "user-1",
        { externalId: "ig-A", accessToken: "encrypted:dead", expiresAt },
        now,
      ),
    ).rejects.toBeInstanceOf(InstagramTokenExpiredError);
    expect(update).not.toHaveBeenCalled();
    // The alarm must fire even though this path throws — sustained drift marches
    // tokens past expiry, and a silent alarm there defeats its purpose.
    const warned = consoleSpy.mock.calls.some((call) =>
      String(call[0]).includes("drift"),
    );
    expect(warned).toBe(true);
    consoleSpy.mockRestore();
  });

  it("does not stamp the row when the already-expired token fails a non-API refresh", async () => {
    const { db, update } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() - MS_PER_DAY);
    mockRefreshLongLivedToken.mockRejectedValue(new Error("network down"));

    await expect(
      ensureFreshInstagramToken(
        db,
        "user-1",
        { externalId: "ig-A", accessToken: "encrypted:dead", expiresAt },
        now,
      ),
    ).rejects.toBeInstanceOf(InstagramTokenExpiredError);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns the fresh token even when persisting it fails", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, where } = makeUpdatableDb();
    where.mockRejectedValue(new Error("db down"));
    const expiresAt = new Date(
      now.getTime() + (INSTAGRAM_REFRESH_THRESHOLD_DAYS - 1) * MS_PER_DAY,
    );
    mockRefreshLongLivedToken.mockResolvedValue({
      access_token: "new-token",
      token_type: "bearer",
      expires_in: 5_183_944,
    });

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      { externalId: "ig-A", accessToken: "encrypted:old-token", expiresAt },
      now,
    );

    expect(token).toBe("new-token");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("falls back on a transient 429 while the token is still valid", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = makeUpdatableDb();
    const expiresAt = new Date(now.getTime() + 2 * MS_PER_DAY);
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("rate limited", 429),
    );

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      { externalId: "ig-A", accessToken: "encrypted:still-valid", expiresAt },
      now,
    );

    expect(token).toBe("still-valid");
    consoleSpy.mockRestore();
  });
});
