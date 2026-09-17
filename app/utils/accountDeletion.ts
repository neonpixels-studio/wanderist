/**
 * UI-copy constant for account deletion.
 *
 * Mirrors `DELETE_GRACE_PERIOD_DAYS` in `server/utils/accountLifecycle.ts`,
 * which is the actual source of truth for when the purge job erases a
 * soft-deleted account. Deliberately duplicated rather than imported —
 * app/ code ships to the client bundle, and importing a server/ module
 * from there risks pulling server-only code across that boundary. Instead,
 * `app/utils/__tests__/accountDeletion.test.ts` asserts this stays equal
 * to the server constant, so drift fails a test instead of shipping a
 * silently wrong number of days to users.
 */
export const DELETION_GRACE_PERIOD_DAYS = 14;
