import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";

let cachedDb: ReturnType<typeof drizzle> | null = null;

/**
 * Builds a drizzle client from an explicit connection string. Exported
 * separately from getDb() so callers that run outside the Nitro request
 * context — e.g. netlify/functions/purge-deleted-accounts.mts, a standalone
 * scheduled function bundled by Netlify rather than by Nitro, where
 * useRuntimeConfig() is not available — can construct a client from
 * process.env directly instead.
 */
export function createDb(databaseUrl: string) {
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL");
  }
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (cachedDb) return cachedDb;
  // Prefer the live env var over runtimeConfig, matching every other server
  // file's `process.env.X || useRuntimeConfig().x` pattern. This is load-bearing
  // under dotenvx: `nuxt dev` auto-loads the committed (encrypted) .env and bakes
  // its `DATABASE_URL=encrypted:…` ciphertext into runtimeConfig.databaseUrl. In
  // e2e/CI the real connection arrives at runtime via E2E_DATABASE_URL (a fresh
  // Neon branch), so reading process.env first lets it win over that ciphertext.
  // In production both env vars are unset at runtime and the build-baked
  // runtimeConfig value (injected from process.env at build) is used.
  const databaseUrl =
    process.env.E2E_DATABASE_URL ||
    process.env.DATABASE_URL ||
    useRuntimeConfig().databaseUrl;
  cachedDb = createDb(databaseUrl);
  return cachedDb;
}

/**
 * Runs a variable-length list of statements as one atomic database.batch()
 * call — the neon-http driver's real BEGIN/COMMIT unit. Callers build
 * `statements` dynamically (some writes are conditional on the request body),
 * so its length isn't known at the type level, but drizzle's `batch()` is
 * typed to require a non-empty tuple. Owning the `as [...]` cast and the
 * empty-array guard here means every call site enforces the same invariant
 * (an empty batch is a silent no-op, never a runtime call to Neon) instead of
 * each one reimplementing — and potentially forgetting — its own guard.
 */
export async function runBatch(
  database: ReturnType<typeof getDb>,
  statements: BatchItem<"pg">[],
): Promise<unknown[]> {
  if (statements.length === 0) {
    return [];
  }
  return database.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}
