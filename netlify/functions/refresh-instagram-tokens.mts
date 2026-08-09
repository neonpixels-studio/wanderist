/**
 * Scheduled Netlify Function: refreshes Instagram long-lived tokens nearing
 * their 60-day expiry (server/db/schema.ts connectedAccounts.expiresAt). See
 * server/utils/refreshInstagramTokens.ts for the actual query and refresh
 * loop — this file is a thin adapter that wires that logic to a real DB
 * connection and to Netlify's scheduled-function invocation.
 *
 * Deliberately lives outside server/ and is bundled independently by Netlify
 * (not by Nitro), mirroring purge-deleted-accounts.mts: Nitro's netlify preset
 * bundles server/api/** into a single request-driven function with no facility
 * for a cron-scheduled invocation. netlify/functions/ is Netlify's own,
 * separate functions directory, wired to a schedule via netlify.toml
 * ([functions."refresh-instagram-tokens"].schedule).
 *
 * Because this file is not part of the Nitro bundle, it cannot use
 * useRuntimeConfig() or any other Nitro auto-import — it reads DATABASE_URL
 * directly from process.env via createDb().
 *
 * Per-account failures where Instagram genuinely revoked the token (a code-190
 * revocation or a 401 — the user revoked access or it lapsed) are expected and
 * non-fatal: they are collected, logged, and the row is stamped expired so it
 * stops recurring. What is fatal, and re-thrown so Netlify records the
 * invocation as failed, is: an unexpected error (e.g. the DB query throwing), a
 * missing encryption key, or a run where nothing succeeded yet a *recoverable*
 * failure occurred (a rotated app secret, a 429/5xx storm) — a real problem, not
 * a stray revoked account. An ambiguous, unclassified 400 (no usable Meta code)
 * is excluded from that alarm: it is retried, not evidence that infrastructure
 * is down, so one such failure on a quiet day must not fail the whole run.
 * Mirrors purge-deleted-accounts.mts.
 */
import { createDb } from "../../server/db/index";
import { refreshExpiringInstagramTokens } from "../../server/utils/refreshInstagramTokens";

export const handler = async () => {
  try {
    // This standalone function reads secrets straight from the Netlify
    // Functions env (it is not in the Nitro bundle, so useRuntimeConfig() is
    // unavailable). Fail fast with a clear message if either is unset, rather
    // than surfacing a driver error or a ReferenceError deep in token decrypt.
    if (!process.env.DATABASE_URL) {
      throw new Error("refresh-instagram-tokens: DATABASE_URL is not set");
    }
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      throw new Error(
        "refresh-instagram-tokens: TOKEN_ENCRYPTION_KEY is not set",
      );
    }

    const db = createDb(process.env.DATABASE_URL);
    const result = await refreshExpiringInstagramTokens(db);

    console.log(
      `refresh-instagram-tokens: refreshed ${result.refreshedCount} token(s)`,
      result.refreshedUserIds,
    );
    if (result.capReached) {
      console.warn(
        "refresh-instagram-tokens: batch limit reached — remaining tokens will be handled on the next run",
      );
    }
    if (result.failures.length > 0) {
      console.warn(
        `refresh-instagram-tokens: ${result.failures.length} token(s) failed to refresh`,
        result.failures,
      );
    }

    // Nothing renewed AND at least one recoverable failure (not a revocation the
    // user must reconnect, and not a lone ambiguous 400) means the job itself is
    // broken — a rotated secret or a transient outage hitting everything. Throw
    // so Netlify marks the run failed. Runs whose only failures are revoked
    // accounts or unclassified 400s stay green.
    const recoverableFailures = result.failures.filter(
      (failure) => !failure.unrecoverable && !failure.unclassified,
    );
    if (result.refreshedCount === 0 && recoverableFailures.length > 0) {
      throw new Error(
        `refresh-instagram-tokens: ${recoverableFailures.length} recoverable refresh failure(s) with no successes`,
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error("refresh-instagram-tokens: refresh run failed", error);
    throw error;
  }
};
