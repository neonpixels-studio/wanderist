/**
 * Instagram long-lived token lifecycle: expiry checks, refresh + persistence,
 * and the on-use "self-heal" path.
 *
 * Instagram long-lived tokens last 60 days and are silently useless once they
 * lapse. This module keeps a stored token fresh: it decides when a token is
 * close enough to expiry to refresh, exchanges it via the Instagram Graph
 * refresh endpoint, and writes the new token + expiry back to
 * `connected_accounts`.
 *
 * Isolated from the Nitro request context (no getDb()/useRuntimeConfig() call
 * here — the caller passes the db in) so it can be unit tested against a plain
 * mocked db chain, with the Instagram client and token crypto mocked at their
 * module boundaries.
 */
import { and, eq } from "drizzle-orm";
import type { createDb } from "../db/index";
import { connectedAccounts, CONNECTED_ACCOUNT_PROVIDER } from "../db/schema";
import {
  refreshLongLivedToken,
  InstagramApiError,
  type InstagramLongLivedTokenResponse,
} from "./instagramClient";
import { decryptToken, encryptToken } from "./tokenCrypto";
import { MS_PER_DAY } from "./accountLifecycle";

export type InstagramTokenDb = ReturnType<typeof createDb>;

// Refresh once a token is within this many days of its 60-day expiry. Wide
// enough that an account syncing even monthly is always renewed before it
// lapses, while avoiding a refresh on every single import.
export const INSTAGRAM_REFRESH_THRESHOLD_DAYS = 10;

// Instagram's documented long-lived token lifetime. Used as the expiry when a
// token response omits `expires_in`, so a freshly minted token always has a
// known (non-null) expiry rather than being treated as immediately near-expiry.
export const INSTAGRAM_LONG_LIVED_TOKEN_DAYS = 60;

// Instagram answers 400/401 when a token is expired or the user revoked
// access — unrecoverable by refresh, so the connection must be re-established.
const UNRECOVERABLE_REFRESH_STATUSES = new Set([400, 401]);

/**
 * Thrown when a stored token is already past expiry and Instagram refuses to
 * refresh it. Callers translate this into a "reconnect your account" response
 * rather than an opaque 500 — it is a user action, not a server fault.
 */
export class InstagramTokenExpiredError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InstagramTokenExpiredError";
  }
}

export interface StoredInstagramToken {
  // The Instagram-assigned account id; with `provider` it uniquely identifies
  // the connected_accounts row, so the refresh writes back to exactly one row
  // even when a user has connected more than one Instagram account.
  externalId: string;
  // Ciphertext as stored in connected_accounts.accessToken.
  accessToken: string;
  expiresAt: Date | null;
}

/**
 * True when a token should be refreshed now: it expires within the threshold
 * window. A null expiry (a row connected before expiry was persisted) counts
 * as near-expiry so the next use backfills a real expiry by refreshing.
 */
export function isInstagramTokenNearExpiry(
  expiresAt: Date | null,
  now: Date,
): boolean {
  if (!expiresAt) {
    return true;
  }
  const remainingMs = expiresAt.getTime() - now.getTime();
  return remainingMs < INSTAGRAM_REFRESH_THRESHOLD_DAYS * MS_PER_DAY;
}

/**
 * True only when a token's expiry is known and already past. A null expiry is
 * treated as not-yet-expired: we can't prove it's dead, so the caller should
 * still attempt to use it rather than hard-fail.
 */
export function isInstagramTokenExpired(
  expiresAt: Date | null,
  now: Date,
): boolean {
  if (!expiresAt) {
    return false;
  }
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Absolute expiry for a freshly refreshed or long-lived token, derived from
 * the API's `expires_in` (seconds from now). When the response omits
 * `expires_in`, falls back to Instagram's documented 60-day lifetime rather
 * than null — a token we were just handed is valid for ~60 days, and storing
 * that estimate keeps a connected account from looking permanently near-expiry
 * (which would refresh on every import and could reject a <24h-old token).
 */
export function expiryFromResponse(
  response: InstagramLongLivedTokenResponse,
  now: Date,
): Date {
  if (typeof response.expires_in !== "number") {
    return new Date(
      now.getTime() + INSTAGRAM_LONG_LIVED_TOKEN_DAYS * MS_PER_DAY,
    );
  }
  return new Date(now.getTime() + response.expires_in * 1000);
}

// Targets exactly one row via the table's unique key, so a user with multiple
// connected Instagram accounts only ever has the intended account's row
// touched. Shared by every write here so the scoping can't drift between them.
function instagramAccountWhere(externalId: string) {
  return and(
    eq(connectedAccounts.provider, CONNECTED_ACCOUNT_PROVIDER.INSTAGRAM),
    eq(connectedAccounts.externalId, externalId),
  );
}

/**
 * True when a refresh failure means the token is dead from Instagram's side
 * (400/401 — expired or revoked) and only reconnecting can fix it. Shared by
 * the on-use path and the scheduled batch so both classify failures the same.
 */
export function isUnrecoverableRefreshError(error: unknown): boolean {
  return (
    error instanceof InstagramApiError &&
    UNRECOVERABLE_REFRESH_STATUSES.has(error.status)
  );
}

/**
 * Writes a refreshed token + its new expiry to the Instagram row identified by
 * `(provider, externalId)`. Shared by the on-use path and the scheduled batch
 * job so both persist identically.
 */
export async function persistRefreshedInstagramToken(
  db: InstagramTokenDb,
  externalId: string,
  response: InstagramLongLivedTokenResponse,
  now: Date,
): Promise<Date> {
  const expiresAt = expiryFromResponse(response, now);
  await db
    .update(connectedAccounts)
    .set({
      accessToken: encryptToken(response.access_token),
      expiresAt,
    })
    .where(instagramAccountWhere(externalId));
  return expiresAt;
}

/**
 * Stamps a row's expiry as `now`, marking its token dead. Used when Instagram
 * refuses a refresh (400/401): the row then falls out of the scheduled job's
 * "still in the future" due window instead of being retried every run, and the
 * on-use path treats it as expired so the user is prompted to reconnect.
 */
export async function markInstagramTokenExpired(
  db: InstagramTokenDb,
  externalId: string,
  now: Date,
): Promise<void> {
  await db
    .update(connectedAccounts)
    .set({ expiresAt: now })
    .where(instagramAccountWhere(externalId));
}

/**
 * Stamps a row expired without letting the write itself propagate. Both the
 * on-use path and the scheduled batch call this after Instagram rejects a
 * token: the caller has already classified the account as dead, so a DB error
 * on the stamp must not abort the caller (fail the import / take down the
 * batch). The failure is surfaced via a log rather than a throw.
 */
export async function markInstagramTokenExpiredBestEffort(
  db: InstagramTokenDb,
  externalId: string,
  now: Date,
): Promise<void> {
  try {
    await markInstagramTokenExpired(db, externalId, now);
  } catch (markError) {
    console.warn(
      "markInstagramTokenExpiredBestEffort: failed to mark token expired",
      { externalId, markError },
    );
  }
}

/**
 * A refresh failure is unrecoverable when Instagram itself rejected the token
 * (400/401 — expired or revoked), or when our own stored expiry is already
 * past. Either way the user must reconnect; the caller turns this into a
 * "reconnect" response rather than retrying a dead token. Transient failures
 * (429/5xx/network) on a still-valid token are recoverable — fall back and
 * retry next run.
 */
function isRefreshUnrecoverable(
  error: unknown,
  expiresAt: Date | null,
  now: Date,
): boolean {
  return (
    isUnrecoverableRefreshError(error) ||
    isInstagramTokenExpired(expiresAt, now)
  );
}

/**
 * Returns a usable plaintext Instagram token for the user, refreshing and
 * persisting first when the stored token is near expiry.
 *
 * Failure handling: a transient refresh failure on a still-valid token is
 * logged and the current token is returned (the next run retries). A failure
 * that means the token is dead — Instagram answered 400/401, or the stored
 * expiry is already past — is surfaced as InstagramTokenExpiredError so the
 * caller can prompt a reconnect instead of calling Instagram with a dead token.
 */
export async function ensureFreshInstagramToken(
  db: InstagramTokenDb,
  userId: string,
  stored: StoredInstagramToken,
  now: Date = new Date(),
): Promise<string> {
  const currentToken = decryptToken(stored.accessToken);
  if (!isInstagramTokenNearExpiry(stored.expiresAt, now)) {
    return currentToken;
  }

  let refreshed: InstagramLongLivedTokenResponse;
  try {
    refreshed = await refreshLongLivedToken({ accessToken: currentToken });
  } catch (error) {
    if (isRefreshUnrecoverable(error, stored.expiresAt, now)) {
      // Instagram rejected the token (400/401): stamp the row expired so
      // repeated imports inside the refresh window stop firing a live,
      // guaranteed-to-fail refresh until the nightly job cleans it up. Gated on
      // the API rejection specifically — an already-past stored expiry needs no
      // stamp. Best-effort so a stamp failure still surfaces the reconnect.
      if (isUnrecoverableRefreshError(error)) {
        await markInstagramTokenExpiredBestEffort(db, stored.externalId, now);
      }
      throw new InstagramTokenExpiredError(
        "Instagram token expired and could not be refreshed",
        { cause: error },
      );
    }
    console.warn(
      "ensureFreshInstagramToken: refresh failed, using existing token",
      { userId, error },
    );
    return currentToken;
  }

  // The refreshed token is already valid; a failure persisting it must not fail
  // the import that triggered the refresh. Return the fresh token and let the
  // next run re-refresh + re-persist from the still-stored older token.
  try {
    await persistRefreshedInstagramToken(db, stored.externalId, refreshed, now);
  } catch (persistError) {
    console.warn(
      "ensureFreshInstagramToken: refreshed token could not be persisted",
      { userId, persistError },
    );
  }
  return refreshed.access_token;
}
