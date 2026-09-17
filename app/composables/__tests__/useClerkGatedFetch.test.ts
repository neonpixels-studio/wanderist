import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, nextTick } from "vue";
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
    const { gate } = useClerkGatedFetch(isClerkLoaded);
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
    const { gate } = useClerkGatedFetch(isClerkLoaded);
    const fetchFn = vi.fn().mockResolvedValue("result");

    gate(fetchFn);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not call fetchFn itself once isClerkLoaded resolves (that is the caller's job)", async () => {
    // Regression guard for the no-double-fetch contract documented on gate():
    // if this resolved isClerkLoaded's flip by calling fetchFn directly, a
    // caller that ALSO reacts to isClerkLoaded (as guides/[id].vue and
    // trips/[id].vue both do, via their useAsyncData watch array) would fire
    // the same request twice for one resolution.
    const isClerkLoaded = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded);
    const fetchFn = vi.fn().mockResolvedValue("result");

    gate(fetchFn);
    isClerkLoaded.value = true;
    await nextTick();

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("lets a fresh call fire fetchFn immediately once isClerkLoaded has resolved", () => {
    const isClerkLoaded = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded);
    const fetchFn = vi.fn().mockResolvedValue("result");

    gate(fetchFn);
    isClerkLoaded.value = true;
    // This mirrors the caller re-invoking gate() from its own watch, the
    // second half of the contract the previous test checks the first half of.
    gate(fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("fires fetchFn anonymously after the bootstrap grace period if isClerkLoaded never resolves", async () => {
    vi.useFakeTimers();
    const isClerkLoaded = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded);
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
    const { gate } = useClerkGatedFetch(isClerkLoaded);
    const fetchFn = vi.fn().mockResolvedValue("result");

    gate(fetchFn);
    isClerkLoaded.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

    // Per the no-double-fetch contract, resolving isClerkLoaded does not call
    // fetchFn itself — but it must also cancel the pending timeout, so the
    // grace period elapsing afterward does not fire a second, redundant call.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the grace-period fallback", async () => {
    vi.useFakeTimers();
    const isClerkLoaded = ref(false);
    const { gate } = useClerkGatedFetch(isClerkLoaded);
    const fetchFn = vi.fn().mockRejectedValue(new Error("network error"));

    const resultPromise = gate(fetchFn);
    resultPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

    await expect(resultPromise).rejects.toThrow("network error");
  });
});
