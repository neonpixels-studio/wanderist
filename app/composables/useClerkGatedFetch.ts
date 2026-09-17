/**
 * Bridges Clerk's async local bootstrap into any fetch that needs to know
 * whether it can carry an auth token before it decides what to request.
 *
 * Written for #255: guides/[id].vue and trips/[id].vue used to fire their
 * detail fetch immediately on mount, before Clerk had a chance to resolve.
 * For a signed-in owner on a hard refresh that meant an anonymous request
 * 404'd their own private resource, and the page rendered "not found" for a
 * frame before the authenticated retry (driven by each page's own
 * canRetryAuthenticated) landed. Wrapping the fetch in `gate()` withholds it
 * until isLoaded resolves; since Clerk resolves isLoaded and isSignedIn
 * together (the same contract useEntryDraft's onDraftReady relies on), the
 * very first request a signed-in owner's page makes is already authenticated
 * — there is no separate anonymous-then-retry pass left to race against.
 *
 * Usage: pass `isClerkLoaded` from the same `useClerkAuth()` call the page
 * already makes (for isSignedIn/isOwner/etc.), and include it in the
 * `useAsyncData` `watch` array alongside the page's own auth-derived sources.
 * `gate()` does NOT itself re-invoke `fetchFn` once isClerkLoaded flips true —
 * that re-invocation is the watch array's job (see below) — so `gate()` must
 * be called again from the outside once notified; calling it twice for the
 * same resolution is safe (the second, post-resolution call takes the direct
 * fast path and fires the real request; the first call's promise is simply
 * abandoned, unresolved, once superseded). This split avoids a double
 * request: if `gate()` resolved itself here, both it and the caller's own
 * watch would fire fetchFn for the same event.
 *
 *   const canRetryAuthenticated = computed(() => isClerkLoaded.value && !!isSignedIn.value);
 *   const { gate } = useClerkGatedFetch(isClerkLoaded);
 *   const { status } = useAsyncData(
 *     key,
 *     () => gate(() => store.fetchById(id.value)),
 *     { server: false, watch: [id, canRetryAuthenticated, isClerkLoaded] },
 *   );
 *
 * Bounded by CLERK_BOOTSTRAP_TIMEOUT_MS rather than waiting indefinitely: a
 * public resource needs nothing from Clerk to be viewed anonymously, so if
 * Clerk's script never loads at all (blocked by an ad blocker, a corporate
 * proxy, a flaky CDN) the timeout elapses and fetchFn still runs — exactly
 * the anonymous fetch that would have fired immediately before this fix,
 * just deferred by at most CLERK_BOOTSTRAP_TIMEOUT_MS. No precedent in this
 * codebase (middleware/auth.ts, useEntryDraft's onDraftReady) treats a stuck
 * Clerk bootstrap as recoverable for an *authenticated* surface, but a public
 * share link is a different case this codebase has already decided must not
 * hang on Clerk — see the isLoading comments in guides/[id].vue and
 * trips/[id].vue.
 */
export const CLERK_BOOTSTRAP_TIMEOUT_MS = 2000;

export function useClerkGatedFetch(isClerkLoaded: Ref<boolean>) {
  function gate<FetchResult>(
    fetchFn: () => Promise<FetchResult>,
  ): Promise<FetchResult> {
    if (isClerkLoaded.value) {
      return fetchFn();
    }

    return new Promise<FetchResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        stopWatchingClerkLoaded();
        fetchFn().then(resolve, reject);
      }, CLERK_BOOTSTRAP_TIMEOUT_MS);

      const stopWatchingClerkLoaded = watch(isClerkLoaded, (loaded) => {
        if (!loaded) {
          return;
        }
        clearTimeout(timeoutId);
        stopWatchingClerkLoaded();
        // Deliberately does not call fetchFn/resolve/reject: this promise is
        // left pending and abandoned. The caller's own watch on
        // isClerkLoaded (see the usage contract above) re-invokes gate()
        // once Clerk resolves, and that fresh call takes the fast path
        // above. Calling fetchFn from both places would fire the request
        // twice for the same resolution.
      });
    });
  }

  return { gate };
}
