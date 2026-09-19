/**
 * Thin alias for @clerk/nuxt's useClerk composable.
 *
 * Provides a stable project-level name used throughout the codebase, same as
 * useClerkAuth/useClerkUser, and gives call sites (and their tests) a single
 * seam to mock instead of reaching for the raw Clerk SDK export. Exposing it
 * as a dedicated composable ensures Nuxt auto-imports it alongside the other
 * composables in this directory.
 */
export function useClerkInstance() {
  return useClerk();
}
