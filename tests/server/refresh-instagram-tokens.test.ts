/**
 * Unit tests for server/utils/refreshInstagramTokens.ts — the scheduled
 * batch that refreshes Instagram long-lived tokens nearing expiry.
 *
 * The Instagram client and token crypto are mocked at their module
 * boundaries; the drizzle db is a mocked select/update chain — no network or
 * database access. Same isolation pattern as
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

// Only the network-touching surface is mocked; the classification constants
// come through from the real module so this suite fails if those values drift.
vi.mock("../../server/utils/instagramClient", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/utils/instagramClient")
  >()),
  refreshLongLivedToken: mockRefreshLongLivedToken,
  InstagramApiError: MockInstagramApiError,
}));

// A genuine Meta token revocation — the only 400 the batch treats as
// unrecoverable and stamps expired.
function makeRevocationError(message = "revoked") {
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
  refreshExpiringInstagramTokens,
  refreshCutoff,
  dueAccountsCondition,
  INSTAGRAM_REFRESH_BATCH_LIMIT,
} = await import("../../server/utils/refreshInstagramTokens");
import { INSTAGRAM_REFRESH_THRESHOLD_DAYS } from "../../server/utils/instagramToken";
import { MS_PER_DAY } from "../../server/utils/accountLifecycle";
import { PgDialect } from "drizzle-orm/pg-core";

interface DueAccount {
  userId: string;
  externalId: string;
  accessToken: string | null;
}

function makeDb(dueAccounts: DueAccount[]) {
  const limit = vi.fn().mockResolvedValue(dueAccounts);
  const orderBy = vi.fn(() => ({ limit }));
  const selectWhere = vi.fn(() => ({ orderBy }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update } as unknown as Parameters<
      typeof refreshExpiringInstagramTokens
    >[0],
    select,
    selectWhere,
    orderBy,
    limit,
    update,
  };
}

// ---------------------------------------------------------------------------
// refreshCutoff — the one predicate that decides which tokens are "due"
// ---------------------------------------------------------------------------

describe("refreshCutoff", () => {
  it("is now plus the refresh threshold", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    expect(refreshCutoff(now)).toEqual(
      new Date(now.getTime() + INSTAGRAM_REFRESH_THRESHOLD_DAYS * MS_PER_DAY),
    );
  });
});

describe("dueAccountsCondition", () => {
  it("selects Instagram rows with a token and a null or in-window expiry, excluding already-expired", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const { sql, params } = new PgDialect().sqlToQuery(
      dueAccountsCondition(now) as never,
    );

    expect(sql).toContain('"provider"');
    expect(sql).toContain('"access_token" is not null');
    expect(sql).toContain('"expires_at" is null');
    // Bounded on both sides: still in the future (>) and within the window (<).
    expect(sql).toContain('"expires_at" > ');
    expect(sql).toContain('"expires_at" < ');
    // Drizzle serializes timestamp params to ISO strings.
    const paramStrings = params.map(String);
    expect(paramStrings).toContain(now.toISOString());
    expect(paramStrings).toContain(refreshCutoff(now).toISOString());
  });
});

describe("refreshExpiringInstagramTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshLongLivedToken.mockResolvedValue({
      access_token: "new-token",
      token_type: "bearer",
      expires_in: 5_183_944,
    });
  });

  it("orders by soonest expiry with nulls first and caps the batch", async () => {
    const { db, orderBy, limit } = makeDb([]);

    await refreshExpiringInstagramTokens(db);

    const { sql } = new PgDialect().sqlToQuery(
      orderBy.mock.calls[0]?.[0] as never,
    );
    expect(sql.toLowerCase()).toContain("nulls first");
    expect(limit).toHaveBeenCalledWith(INSTAGRAM_REFRESH_BATCH_LIMIT);
  });

  it("refreshes every due account and reports their ids", async () => {
    const { db, update } = makeDb([
      { userId: "user-1", externalId: "ig-1", accessToken: "encrypted:t1" },
      { userId: "user-2", externalId: "ig-2", accessToken: "encrypted:t2" },
    ]);

    const result = await refreshExpiringInstagramTokens(db);

    expect(mockRefreshLongLivedToken).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      refreshedUserIds: ["user-1", "user-2"],
      refreshedCount: 2,
      failures: [],
      capReached: false,
    });
  });

  it("reports zero when no account is due", async () => {
    const { db, update } = makeDb([]);

    const result = await refreshExpiringInstagramTokens(db);

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      refreshedUserIds: [],
      refreshedCount: 0,
      failures: [],
      capReached: false,
    });
  });

  it("collects a per-account failure and keeps going with the rest", async () => {
    const { db, update } = makeDb([
      { userId: "user-ok", externalId: "ig-ok", accessToken: "encrypted:ok" },
      {
        userId: "user-bad",
        externalId: "ig-bad",
        accessToken: "encrypted:bad",
      },
    ]);
    mockRefreshLongLivedToken
      .mockResolvedValueOnce({
        access_token: "new-token",
        token_type: "bearer",
        expires_in: 5_183_944,
      })
      .mockRejectedValueOnce(new Error("400 token revoked"));

    const result = await refreshExpiringInstagramTokens(db);

    expect(result.refreshedUserIds).toEqual(["user-ok"]);
    expect(result.refreshedCount).toBe(1);
    expect(result.failures).toEqual([
      { userId: "user-bad", error: "400 token revoked", unrecoverable: false },
    ]);
    // Only the successful persist writes; a recoverable failure must NOT stamp
    // the row expired, or a healthy token would be dropped from the due set.
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("records a failure without an API call when the stored token is null", async () => {
    const { db, update } = makeDb([
      { userId: "user-null", externalId: "ig-null", accessToken: null },
    ]);

    const result = await refreshExpiringInstagramTokens(db);

    expect(mockRefreshLongLivedToken).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.refreshedUserIds).toEqual([]);
    expect(result.failures).toEqual([
      { userId: "user-null", error: "No stored token", unrecoverable: true },
    ]);
  });

  it("marks the row expired and flags unrecoverable on a genuine revocation", async () => {
    const { db, update } = makeDb([
      {
        userId: "user-revoked",
        externalId: "ig-revoked",
        accessToken: "encrypted:dead",
      },
    ]);
    mockRefreshLongLivedToken.mockRejectedValue(makeRevocationError());

    const result = await refreshExpiringInstagramTokens(db);

    // The only db.update is the mark-expired write (no successful persist).
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([
      { userId: "user-revoked", error: "revoked", unrecoverable: true },
    ]);
  });

  it("does not stamp the row or flag unrecoverable on a non-revocation 400", async () => {
    const { db, update } = makeDb([
      {
        userId: "user-transient",
        externalId: "ig-transient",
        accessToken: "encrypted:valid",
      },
    ]);
    // A 400 with no OAuthException code-190 body is transient — the token may
    // still be valid, so the batch must not disconnect it.
    mockRefreshLongLivedToken.mockRejectedValue(
      new MockInstagramApiError("bad request", 400),
    );

    const result = await refreshExpiringInstagramTokens(db);

    expect(update).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      { userId: "user-transient", error: "bad request", unrecoverable: false },
    ]);
  });

  it("keeps the batch alive when the mark-expired write itself fails", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limit = vi.fn().mockResolvedValue([
      { userId: "user-ok", externalId: "ig-ok", accessToken: "encrypted:ok" },
      {
        userId: "user-revoked",
        externalId: "ig-revoked",
        accessToken: "encrypted:dead",
      },
    ]);
    const orderBy = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy })) })),
    }));
    // First update is the successful persist; second is the mark-expired write,
    // which fails — it must not throw out of the batch and lose user-ok.
    const updateWhere = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("db down"));
    const update = vi.fn(() => ({
      set: vi.fn(() => ({ where: updateWhere })),
    }));
    const db = { select, update } as unknown as Parameters<
      typeof refreshExpiringInstagramTokens
    >[0];
    mockRefreshLongLivedToken
      .mockResolvedValueOnce({
        access_token: "new-token",
        token_type: "bearer",
        expires_in: 5_183_944,
      })
      .mockRejectedValueOnce(makeRevocationError());

    const result = await refreshExpiringInstagramTokens(db);

    expect(result.refreshedUserIds).toEqual(["user-ok"]);
    expect(result.failures).toEqual([
      { userId: "user-revoked", error: "revoked", unrecoverable: true },
    ]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("flags capReached when the batch fills to the limit", async () => {
    const full: DueAccount[] = Array.from(
      { length: INSTAGRAM_REFRESH_BATCH_LIMIT },
      (_unused, index) => ({
        userId: `user-${index}`,
        externalId: `ig-${index}`,
        accessToken: `encrypted:t${index}`,
      }),
    );
    const { db } = makeDb(full);

    const result = await refreshExpiringInstagramTokens(db);

    expect(result.capReached).toBe(true);
    expect(result.refreshedCount).toBe(INSTAGRAM_REFRESH_BATCH_LIMIT);
  });
});
