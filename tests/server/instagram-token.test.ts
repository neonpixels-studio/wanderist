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
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../../server/utils/instagramClient", () => ({
  refreshLongLivedToken: mockRefreshLongLivedToken,
  InstagramApiError: MockInstagramApiError,
}));

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
  it("is true for a 400 Instagram API error", () => {
    expect(
      isUnrecoverableRefreshError(new MockInstagramApiError("expired", 400)),
    ).toBe(true);
  });

  it("is true for a 401 Instagram API error", () => {
    expect(
      isUnrecoverableRefreshError(new MockInstagramApiError("revoked", 401)),
    ).toBe(true);
  });

  it("is false for a transient 429 and for non-API errors", () => {
    expect(
      isUnrecoverableRefreshError(new MockInstagramApiError("rate", 429)),
    ).toBe(false);
    expect(isUnrecoverableRefreshError(new Error("network"))).toBe(false);
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

  it("throws InstagramTokenExpiredError on a 400 even when the stored expiry is unknown", async () => {
    const { db } = makeUpdatableDb();
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("session expired", 400),
    );

    await expect(
      ensureFreshInstagramToken(
        db,
        "user-1",
        { externalId: "ig-A", accessToken: "encrypted:dead", expiresAt: null },
        now,
      ),
    ).rejects.toBeInstanceOf(InstagramTokenExpiredError);
  });

  it("stamps the row expired on a 400 so repeated imports stop re-hitting Instagram", async () => {
    const { db, update, set } = makeUpdatableDb();
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("session expired", 400),
    );

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
