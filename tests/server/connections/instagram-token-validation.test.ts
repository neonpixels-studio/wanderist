/**
 * End-to-end guard for the refresh 200-body validation (issue #144).
 *
 * Unlike tests/server/instagram-token.test.ts — which mocks the Instagram
 * client wholesale — this suite runs the REAL refreshLongLivedToken over a
 * stubbed fetch, driving it through ensureFreshInstagramToken into the persist
 * path. Only fetch and tokenCrypto are mocked, so a malformed 200 exercises the
 * true seam: a bad body must fail loud inside the client and never reach
 * encryptToken / a DB write, while a valid body still stores.
 *
 * Mutation check: delete the access_token validation in instagramClient and the
 * "malformed 200" case flips — the undefined token flows to encryptToken and the
 * row is overwritten — so this fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEncryptToken, mockDecryptToken } = vi.hoisted(() => ({
  mockEncryptToken: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  mockDecryptToken: vi.fn((ciphertext: string) =>
    ciphertext.replace(/^encrypted:/, ""),
  ),
}));

vi.mock("../../../server/utils/tokenCrypto", () => ({
  encryptToken: mockEncryptToken,
  decryptToken: mockDecryptToken,
}));

const { ensureFreshInstagramToken } =
  await import("../../../server/utils/instagramToken");
import { MS_PER_DAY } from "../../../server/utils/accountLifecycle";

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeUpdatableDb() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return {
    db: { update } as unknown as Parameters<
      typeof ensureFreshInstagramToken
    >[0],
    update,
    set,
    where,
  };
}

describe("refresh 200-body validation (real client seam)", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  // Near expiry so the refresh path fires, but not yet expired so a failed
  // refresh keeps the current token rather than throwing.
  const nearExpiry = new Date(now.getTime() + 2 * MS_PER_DAY);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("keeps the stored token and never encrypts/overwrites when the 200 body omits access_token", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ token_type: "bearer", expires_in: 5183944 }),
    );
    const { db, update } = makeUpdatableDb();

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      {
        externalId: "ig-A",
        accessToken: "encrypted:still-valid",
        expiresAt: nearExpiry,
      },
      now,
    );

    expect(token).toBe("still-valid");
    expect(mockEncryptToken).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("encrypts and stores the fresh token when the 200 body carries a valid access_token", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({
        access_token: "new-token",
        token_type: "bearer",
        expires_in: 5183944,
      }),
    );
    const { db, update, set } = makeUpdatableDb();

    const token = await ensureFreshInstagramToken(
      db,
      "user-1",
      {
        externalId: "ig-A",
        accessToken: "encrypted:old-token",
        expiresAt: nearExpiry,
      },
      now,
    );

    expect(token).toBe("new-token");
    expect(mockEncryptToken).toHaveBeenCalledWith("new-token");
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "encrypted:new-token" }),
    );
  });
});
