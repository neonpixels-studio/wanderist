/**
 * Batch refresh of Instagram long-lived tokens for the scheduled job
 * (netlify/functions/refresh-instagram-tokens.mts).
 *
 * The on-use path (server/utils/instagramToken.ts ensureFreshInstagramToken)
 * only refreshes a token when its owner actually imports. Accounts that go
 * quiet for 60 days would still lapse silently — this job closes that gap by
 * refreshing every Instagram token nearing expiry on a schedule.
 *
 * Isolated from both the Nitro request context and the Netlify Functions
 * runtime (the caller passes the db in) so it can be unit tested against a
 * plain mocked db chain, with the Instagram client and token crypto mocked at
 * their module boundaries — the same pattern as server/utils/purgeAccounts.ts.
 */
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { createDb } from "../db/index";
import { connectedAccounts, CONNECTED_ACCOUNT_PROVIDER } from "../db/schema";
import { refreshLongLivedToken } from "./instagramClient";
import { decryptToken } from "./tokenCrypto";
import {
  INSTAGRAM_REFRESH_THRESHOLD_DAYS,
  isUnrecoverableRefreshError,
  isUnclassifiedRefresh400,
  warnUnclassifiedRefresh400,
  markInstagramTokenExpiredBestEffort,
  persistRefreshedInstagramToken,
  type InstagramTokenDb,
} from "./instagramToken";
import { MS_PER_DAY } from "./accountLifecycle";

// Cap the rows processed per run. Refreshes are sequential network calls, so
// this bounds how many run per invocation (not wall-clock time): rows are
// ordered by soonest expiry so the most urgent are always handled first, a hit
// cap is logged (never silently swallowed), and the daily cron drains any
// remainder over subsequent runs well inside the 10-day threshold window.
export const INSTAGRAM_REFRESH_BATCH_LIMIT = 100;

export interface InstagramRefreshFailure {
  userId: string;
  error: string;
  // True when the failure is Instagram genuinely revoking the token
  // (OAuthException code 190 — the user must reconnect), false for
  // transient/infrastructure failures (an ambiguous 400, 429, 5xx, network) the
  // caller should treat as a real, retriable problem.
  unrecoverable: boolean;
  // True when the failure is a 400 carrying no usable Meta `code` — recoverable,
  // but ambiguous rather than clear infrastructure breakage. The scheduled
  // adapter excludes these from its "nothing succeeded, infra is down" alarm so
  // a lone ambiguous 400 doesn't mark the whole run failed.
  unclassified: boolean;
}

export interface InstagramRefreshResult {
  refreshedUserIds: string[];
  refreshedCount: number;
  failures: InstagramRefreshFailure[];
  capReached: boolean;
}

/**
 * The instant a token must expire before to be considered "due" for a
 * scheduled refresh: within INSTAGRAM_REFRESH_THRESHOLD_DAYS of now.
 */
export function refreshCutoff(now: Date): Date {
  return new Date(
    now.getTime() + INSTAGRAM_REFRESH_THRESHOLD_DAYS * MS_PER_DAY,
  );
}

/**
 * Rows due for a scheduled refresh: an Instagram row with a stored token whose
 * expiry is either unknown (null — a pre-refresh connection to backfill) or
 * still in the future but within the threshold window. Already-expired rows are
 * excluded: Instagram cannot refresh a lapsed token, so re-selecting them every
 * run would only produce endless failing API calls.
 */
export function dueAccountsCondition(now: Date) {
  return and(
    eq(connectedAccounts.provider, CONNECTED_ACCOUNT_PROVIDER.INSTAGRAM),
    isNotNull(connectedAccounts.accessToken),
    or(
      isNull(connectedAccounts.expiresAt),
      and(
        gt(connectedAccounts.expiresAt, now),
        lt(connectedAccounts.expiresAt, refreshCutoff(now)),
      ),
    ),
  );
}

async function refreshOne(
  db: InstagramTokenDb,
  account: { externalId: string; accessToken: string },
  now: Date,
): Promise<void> {
  const currentToken = decryptToken(account.accessToken);
  const refreshed = await refreshLongLivedToken({ accessToken: currentToken });
  await persistRefreshedInstagramToken(db, account.externalId, refreshed, now);
}

/**
 * Refreshes a single due account, translating any failure into an
 * InstagramRefreshFailure rather than throwing — so one bad account never
 * aborts the batch (the contract this module promises). An unrecoverable
 * failure stamps the row expired, but that stamp is best-effort: a DB error on
 * the stamp is logged and folded into the returned failure, never re-thrown.
 */
async function refreshAccount(
  db: InstagramTokenDb,
  account: { userId: string; externalId: string; accessToken: string | null },
  now: Date,
): Promise<InstagramRefreshFailure | null> {
  if (!account.accessToken) {
    return {
      userId: account.userId,
      error: "No stored token",
      unrecoverable: true,
      unclassified: false,
    };
  }
  try {
    await refreshOne(
      db,
      { externalId: account.externalId, accessToken: account.accessToken },
      now,
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const unrecoverable = isUnrecoverableRefreshError(error);
    if (unrecoverable) {
      // Instagram genuinely revoked the token (OAuthException code 190) — stamp
      // it expired (best-effort, so a stamp failure never aborts the batch) so
      // it drops out of the due window next run instead of failing forever. A
      // transient 400 is left untouched so a still-valid token is retried.
      await markInstagramTokenExpiredBestEffort(db, account.externalId, now);
    }
    const unclassified = isUnclassifiedRefresh400(error);
    if (unclassified) {
      // Drift alarm: a 400 with no usable Meta code is kept as recoverable, but
      // if the error envelope ever changes every revocation would land here and
      // stop prompting reconnects — surface it loudly rather than silently.
      warnUnclassifiedRefresh400(
        "refreshExpiringInstagramTokens",
        account.userId,
        error,
      );
    }
    return {
      userId: account.userId,
      error: message,
      unrecoverable,
      unclassified,
    };
  }
}

/**
 * Refreshes every Instagram token due for renewal. One account's failure never
 * aborts the batch: failures are collected and returned so the caller can
 * surface partial results rather than swallowing them.
 */
export async function refreshExpiringInstagramTokens(
  db: InstagramTokenDb,
  now: Date = new Date(),
): Promise<InstagramRefreshResult> {
  const dueAccounts = await db
    .select({
      userId: connectedAccounts.userId,
      externalId: connectedAccounts.externalId,
      accessToken: connectedAccounts.accessToken,
    })
    .from(connectedAccounts)
    .where(dueAccountsCondition(now))
    // NULLS FIRST: null-expiry rows are pre-refresh/legacy connections of
    // unknown urgency, so handle them ahead of dated rows rather than letting
    // Postgres' default (NULLS LAST on ASC) push them to the back of the batch.
    .orderBy(sql`${connectedAccounts.expiresAt} asc nulls first`)
    .limit(INSTAGRAM_REFRESH_BATCH_LIMIT);

  const refreshedUserIds: string[] = [];
  const failures: InstagramRefreshFailure[] = [];

  for (const account of dueAccounts) {
    const failure = await refreshAccount(db, account, now);
    if (failure) {
      failures.push(failure);
      continue;
    }
    refreshedUserIds.push(account.userId);
  }

  return {
    refreshedUserIds,
    refreshedCount: refreshedUserIds.length,
    failures,
    capReached: dueAccounts.length === INSTAGRAM_REFRESH_BATCH_LIMIT,
  };
}
