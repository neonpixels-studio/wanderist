/**
 * Withholds a fetch until Clerk's local bootstrap resolves, so it doesn't
 * fire anonymously while auth is still resolving (#255) — a signed-in
 * owner's first request then already carries a token, since Clerk resolves
 * isLoaded and isSignedIn together (same contract as useEntryDraft's
 * onDraftReady). Bounded by CLERK_BOOTSTRAP_TIMEOUT_MS so a public resource
 * still loads anonymously if Clerk's script never resolves at all (blocked
 * by an ad blocker, a flaky CDN) — exactly the immediate anonymous fetch
 * this fix defers, just capped rather than instant.
 *
 * Usage — pass `isClerkLoaded` from the caller's own `useClerkAuth()`, and
 * include it in `useAsyncData`'s `watch` array so a later resolution
 * re-invokes `gate()`:
 *
 *   const { gate } = useClerkGatedFetch(isClerkLoaded);
 *   useAsyncData(key, () => gate(() => store.fetchById(id.value)),
 *     { server: false, watch: [id, canRetryAuthenticated, isClerkLoaded] });
 *
 * `gate()` does not itself call `fetchFn` once isClerkLoaded resolves — the
 * caller's watch does that by re-invoking `gate()`, which then takes the
 * fast path below. Settling here too would fire the request twice for one
 * resolution; the pending promise from the withheld call is simply
 * abandoned once superseded (safe: `useAsyncData`'s default `dedupe: "cancel"`
 * ignores a stale execution's result once a newer one has started).
 */
export const CLERK_BOOTSTRAP_TIMEOUT_MS = 2000;

export function useClerkGatedFetch(isClerkLoaded: Ref<boolean>) {
  // Every withheld gate() call registers its timer/watch pair here so a
  // component teardown can clear all of them — otherwise an orphaned timer
  // outlives the page that started it and, once it fires, calls fetchFn for
  // an id/resource the app has already navigated away from, overwriting
  // shared store state a since-mounted, unrelated page then reads.
  const pendingCleanups = new Set<() => void>();
  if (getCurrentScope()) {
    onScopeDispose(() => {
      pendingCleanups.forEach((cleanup) => cleanup());
      pendingCleanups.clear();
    });
  }

  function gate<FetchResult>(
    fetchFn: () => Promise<FetchResult>,
  ): Promise<FetchResult> {
    if (isClerkLoaded.value) {
      return fetchFn();
    }

    return new Promise<FetchResult>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timeoutId);
        stopWatchingClerkLoaded();
        pendingCleanups.delete(cleanup);
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        fetchFn().then(resolve, reject);
      }, CLERK_BOOTSTRAP_TIMEOUT_MS);

      const stopWatchingClerkLoaded = watch(isClerkLoaded, (loaded) => {
        if (!loaded) {
          return;
        }
        cleanup();
      });

      pendingCleanups.add(cleanup);
    });
  }

  return { gate };
}
