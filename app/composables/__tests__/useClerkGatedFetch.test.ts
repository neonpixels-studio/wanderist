import { describe, it, expect, vi, afterEach } from "vitest";
import { ref, nextTick, effectScope, computed } from "vue";
import {
  useClerkGatedFetch,
  CLERK_BOOTSTRAP_TIMEOUT_MS,
} from "../useClerkGatedFetch";

describe("useClerkGatedFetch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls fetchFn synchronously when Clerk has already resolved", () => {
    const isClerkLoaded = ref(true);
    const canRetryAuthenticated = ref(true);
    const { gate } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
    const fetchFn = vi.fn().mockResolvedValue("result");

    const resultPromise = gate(fetchFn);

    // Synchronous, not deferred behind a microtask: a caller that relies on
    // this firing within the same tick as useAsyncData's own immediate call
    // (see guides/[id].vue and trips/[id].vue) must not be broken by an
    // unnecessary await here.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    return expect(resultPromise).resolves.toBe("result");
  });

  it("does not call fetchFn while Clerk has not resolved yet", () => {
    const isClerkLoaded = ref(false);
    const canRetryAuthenticated = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
    const fetchFn = vi.fn().mockResolvedValue("result");

    gate(fetchFn);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("calls fetchFn and settles the same promise once isClerkLoaded resolves", async () => {
    const isClerkLoaded = ref(false);
    const canRetryAuthenticated = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
    const fetchFn = vi.fn().mockResolvedValue("result");

    const resultPromise = gate(fetchFn);
    isClerkLoaded.value = true;
    await nextTick();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(resultPromise).resolves.toBe("result");
  });

  it("fires fetchFn anonymously after the bootstrap grace period if isClerkLoaded never resolves", async () => {
    vi.useFakeTimers();
    const isClerkLoaded = ref(false);
    const canRetryAuthenticated = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
    const fetchFn = vi.fn().mockResolvedValue("result");

    const resultPromise = gate(fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(resultPromise).resolves.toBe("result");
  });

  it("does not fire the grace-period fallback once isClerkLoaded resolves first", async () => {
    vi.useFakeTimers();
    const isClerkLoaded = ref(false);
    const canRetryAuthenticated = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
    const fetchFn = vi.fn().mockResolvedValue("result");

    gate(fetchFn);
    isClerkLoaded.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

    // The gate's own resolution already fired fetchFn once (see the previous
    // test); the grace period lapsing afterward must not fire it again.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("supersedes a still-pending gate rather than letting both eventually fire", async () => {
    // Regression guard: navigating between two ids while Clerk is still
    // resolving (e.g. guide A -> guide B) must not leave guide A's gate
    // pending — its eventual timeout would otherwise call fetchFnA for a
    // resource the app has already navigated away from.
    vi.useFakeTimers();
    const isClerkLoaded = ref(false);
    const canRetryAuthenticated = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
    const fetchFnA = vi.fn().mockResolvedValue("a");
    const fetchFnB = vi.fn().mockResolvedValue("b");

    gate(fetchFnA);
    gate(fetchFnB);

    await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

    expect(fetchFnA).not.toHaveBeenCalled();
    expect(fetchFnB).toHaveBeenCalledTimes(1);
  });

  it("does not count the auth resolution that produced the gate's own fetch as a retry", async () => {
    // The gate only starts watching for retries once it settles, specifically
    // so the same canRetryAuthenticated change that just resolved the gate
    // (a signed-in owner's isLoaded/isSignedIn flipping together) doesn't
    // also increment retryGeneration and trigger a redundant duplicate fetch.
    const isClerkLoaded = ref(false);
    const isSignedIn = ref(false);
    const canRetryAuthenticated = computed(
      () => isClerkLoaded.value && isSignedIn.value,
    );
    const { gate, retryGeneration } = useClerkGatedFetch(
      isClerkLoaded,
      canRetryAuthenticated,
    );
    const fetchFn = vi.fn().mockResolvedValue("result");

    gate(fetchFn);
    isSignedIn.value = true;
    isClerkLoaded.value = true;
    await nextTick();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(retryGeneration.value).toBe(0);
  });

  it("increments retryGeneration for a canRetryAuthenticated change after the gate has already settled", async () => {
    const isClerkLoaded = ref(true);
    const isSignedIn = ref(false);
    const canRetryAuthenticated = computed(
      () => isClerkLoaded.value && isSignedIn.value,
    );
    const { gate, retryGeneration } = useClerkGatedFetch(
      isClerkLoaded,
      canRetryAuthenticated,
    );
    const fetchFn = vi.fn().mockResolvedValue("result");

    gate(fetchFn);
    expect(retryGeneration.value).toBe(0);

    isSignedIn.value = true;
    await nextTick();

    expect(retryGeneration.value).toBe(1);
  });

  it("clears a pending timer/watch on scope disposal so a torn-down page's fetch never fires later", async () => {
    // Regression guard: without this cleanup, a gate() call left pending when
    // a page unmounts (e.g. the visitor navigates away before Clerk resolves)
    // would still fire fetchFn once the grace period lapses, writing into
    // whatever shared store state a since-mounted, unrelated page now reads.
    vi.useFakeTimers();
    const isClerkLoaded = ref(false);
    const canRetryAuthenticated = ref(false);
    const fetchFn = vi.fn().mockResolvedValue("result");
    const scope = effectScope();

    scope.run(() => {
      const { gate } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
      gate(fetchFn);
    });
    scope.stop();

    await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the grace-period fallback", async () => {
    vi.useFakeTimers();
    const isClerkLoaded = ref(false);
    const canRetryAuthenticated = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded, canRetryAuthenticated);
    const fetchFn = vi.fn().mockRejectedValue(new Error("network error"));

    const resultPromise = gate(fetchFn);
    resultPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

    await expect(resultPromise).rejects.toThrow("network error");
  });
});
