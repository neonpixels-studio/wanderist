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
 * Usage — pass `isClerkLoaded` and the caller's own `canRetryAuthenticated`
 * (both from its `useClerkAuth()`), and watch `retryGeneration` instead of
 * `canRetryAuthenticated` directly:
 *
 *   const { gate, retryGeneration } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
 *   useAsyncData(key, () => gate(() => store.fetchById(id.value)),
 *     { server: false, watch: [id, retryGeneration] });
 *
 * `gate()` always calls `fetchFn` itself and settles the promise it returns
 * with the real result — the caller never needs to re-invoke it, so
 * `useAsyncData` never sees a promise that goes permanently unresolved.
 * `retryGeneration` only increments for a `canRetryAuthenticated` change
 * *after* the gate has already concluded once: the gate doesn't start
 * watching for retries until it settles, so the very same auth resolution
 * that produced the gate's own (already-correct) request never also
 * increments `retryGeneration` and triggers a redundant duplicate.
 */
export const CLERK_BOOTSTRAP_TIMEOUT_MS = 2000;

export function useClerkGatedFetch(
  isClerkLoaded: Ref<boolean>,
  canRetryAuthenticated: Ref<boolean> | ComputedRef<boolean>,
) {
  // Every withheld gate() call registers its timer/watch pair here so a
  // component teardown — or a newer gate() call superseding an older one
  // (e.g. the route id changing while Clerk is still resolving) — can clear
  // it. Left unhandled, an orphaned timer outlives the page/id that started
  // it and, once it fires, calls fetchFn for a resource the app has already
  // navigated away from, overwriting shared store state a since-mounted,
  // unrelated page then reads.
  const pendingCleanups = new Set<() => void>();

  const retryGeneration = ref(0);
  let stopWatchingForRetries: (() => void) | null = null;

  if (getCurrentScope()) {
    onScopeDispose(() => {
      pendingCleanups.forEach((cleanup) => cleanup());
      pendingCleanups.clear();
      stopWatchingForRetries?.();
    });
  }

  // Starts (once) only after the gate this call belongs to has concluded, so
  // the auth state that just produced this gate's own request can't also be
  // the "change" that triggers a retry of it.
  function startWatchingForRetries(): void {
    if (stopWatchingForRetries) {
      return;
    }
    stopWatchingForRetries = watch(canRetryAuthenticated, () => {
      retryGeneration.value += 1;
    });
  }

  function gate<FetchResult>(
    fetchFn: () => Promise<FetchResult>,
  ): Promise<FetchResult> {
    pendingCleanups.forEach((cleanup) => cleanup());

    if (isClerkLoaded.value) {
      startWatchingForRetries();
      return fetchFn();
    }

    return new Promise<FetchResult>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timeoutId);
        stopWatchingClerkLoaded();
        pendingCleanups.delete(cleanup);
      };

      const settle = (): void => {
        cleanup();
        startWatchingForRetries();
        fetchFn().then(resolve, reject);
      };

      const timeoutId = setTimeout(settle, CLERK_BOOTSTRAP_TIMEOUT_MS);

      const stopWatchingClerkLoaded = watch(isClerkLoaded, (loaded) => {
        if (!loaded) {
          return;
        }
        settle();
      });

      pendingCleanups.add(cleanup);
    });
  }

  return { gate, retryGeneration };
}
