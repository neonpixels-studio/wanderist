import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// useApiClient is a Nuxt auto-imported composable. Stub it before importing
// the store so the module resolves against a controlled mock.
const mockApiFetch = vi.fn();
vi.stubGlobal("useApiClient", () => ({ apiFetch: mockApiFetch }));

// Import after globals are set. guides.ts imports defineStore directly from
// "pinia" (not via a Nuxt auto-import), so no defineStore global stub is
// needed here — a plain import of the real pinia already resolves it.
const { useGuidesStore } = await import("../guides");
import type { FetchGuidesResult } from "../guides";

describe("useGuidesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // fetchGuides
  // ---------------------------------------------------------------------------

  describe("fetchGuides", () => {
    it("populates guides on success", async () => {
      const mockGuides = [
        { id: "g-1", userId: "u-1", title: "Tokyo on foot" },
        { id: "g-2", userId: "u-1", title: "Slow coastlines" },
      ];
      mockApiFetch.mockResolvedValueOnce({
        guides: mockGuides,
        page: 1,
        hasMore: false,
      });

      const store = useGuidesStore();
      await store.fetchGuides();

      expect(store.guides).toEqual(mockGuides);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("calls GET /api/guides with page=1", async () => {
      mockApiFetch.mockResolvedValue({ guides: [], page: 1, hasMore: false });
      const store = useGuidesStore();
      await store.fetchGuides();

      expect(mockApiFetch).toHaveBeenCalledWith("/api/guides?page=1");
    });

    it("walks every page and concatenates the results while hasMore is true", async () => {
      const pageOne = Array.from({ length: 20 }, (_, index) => ({
        id: `g-${index}`,
        userId: "u-1",
        title: `Guide ${index}`,
      }));
      const pageTwo = [{ id: "g-20", userId: "u-1", title: "Last Guide" }];

      mockApiFetch
        .mockResolvedValueOnce({ guides: pageOne, page: 1, hasMore: true })
        .mockResolvedValueOnce({ guides: pageTwo, page: 2, hasMore: false });

      const store = useGuidesStore();
      await store.fetchGuides();

      expect(store.guides).toEqual([...pageOne, ...pageTwo]);
      expect(mockApiFetch).toHaveBeenCalledTimes(2);
      expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/api/guides?page=1");
      expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/api/guides?page=2");
    });

    it("throws on a malformed response rather than silently returning a partial list", async () => {
      mockApiFetch.mockResolvedValueOnce({ page: 1, hasMore: false });
      const store = useGuidesStore();

      await expect(store.fetchGuides()).rejects.toThrow(/Malformed/);
      // The whole point of the throw is to not strand consumers with partial
      // or falsely-authoritative state.
      expect(store.isLoading).toBe(false);
      expect(store.hasLoaded).toBe(false);
      expect(store.guides).toEqual([]);
      expect(store.error).not.toBeNull();
    });

    it("throws mid-walk on a malformed later page without exposing the partial list", async () => {
      const pageOne = [{ id: "g-1", userId: "u-1", title: "Tokyo" }];
      mockApiFetch
        .mockResolvedValueOnce({ guides: pageOne, page: 1, hasMore: true })
        .mockResolvedValueOnce({ guides: [], page: 2, hasMore: "yes" });
      const store = useGuidesStore();

      await expect(store.fetchGuides()).rejects.toThrow(/Malformed/);
      // page 1's rows must not leak into the store as if they were the full set.
      expect(store.guides).toEqual([]);
      expect(store.hasLoaded).toBe(false);
    });

    it("retains a previously-loaded list when a later refetch fails mid-walk", async () => {
      const loaded = [
        { id: "g-1", userId: "u-1", title: "Tokyo" },
        { id: "g-2", userId: "u-1", title: "Osaka" },
      ];
      mockApiFetch.mockResolvedValueOnce({
        guides: loaded,
        page: 1,
        hasMore: false,
      });

      const store = useGuidesStore();
      await store.fetchGuides();
      expect(store.guides).toEqual(loaded);

      // A transient failure on a refetch must not blank a working list — the
      // stale-but-complete list is better than an empty one under the error.
      mockApiFetch.mockRejectedValueOnce(new Error("Network error"));
      await expect(store.fetchGuides()).rejects.toThrow("Network error");

      expect(store.guides).toEqual(loaded);
      expect(store.hasLoaded).toBe(true);
      expect(store.error).toBe("Network error");
    });

    it("throws instead of looping forever when the API never stops reporting hasMore", async () => {
      mockApiFetch.mockResolvedValue({ guides: [], page: 1, hasMore: true });
      const store = useGuidesStore();

      await expect(store.fetchGuides()).rejects.toThrow(/exceeded 500 pages/);
      // Asserting the call count pins the bound itself, not just the message.
      expect(mockApiFetch).toHaveBeenCalledTimes(500);
    });

    it("sets isLoading true during fetch", async () => {
      let capturedLoading = false;
      const store = useGuidesStore();

      mockApiFetch.mockImplementation(async () => {
        capturedLoading = store.isLoading;
        return { guides: [], page: 1, hasMore: false };
      });

      await store.fetchGuides();

      expect(capturedLoading).toBe(true);
    });

    it("resets isLoading to false after fetch", async () => {
      mockApiFetch.mockResolvedValue({ guides: [], page: 1, hasMore: false });
      const store = useGuidesStore();
      await store.fetchGuides();

      expect(store.isLoading).toBe(false);
    });

    it("sets error and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Network error"));
      const store = useGuidesStore();

      await expect(store.fetchGuides()).rejects.toThrow("Network error");

      expect(store.error).toBe("Network error");
      expect(store.isLoading).toBe(false);
    });

    it("sets hasLoaded on success", async () => {
      mockApiFetch.mockResolvedValue({ guides: [], page: 1, hasMore: false });
      const store = useGuidesStore();

      expect(store.hasLoaded).toBe(false);
      await store.fetchGuides();

      expect(store.hasLoaded).toBe(true);
    });

    it("does not set hasLoaded when the fetch fails", async () => {
      mockApiFetch.mockRejectedValue(new Error("Network error"));
      const store = useGuidesStore();

      await expect(store.fetchGuides()).rejects.toThrow("Network error");

      expect(store.hasLoaded).toBe(false);
    });

    it("dedupes concurrent calls into a single request", async () => {
      const mockGuides = [{ id: "g-1", userId: "u-1", title: "Tokyo" }];
      let resolveFetch: (value: FetchGuidesResult) => void;
      mockApiFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const store = useGuidesStore();
      const first = store.fetchGuides();
      const second = store.fetchGuides();

      resolveFetch!({ guides: mockGuides, page: 1, hasMore: false });
      await Promise.all([first, second]);

      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      expect(store.guides).toEqual(mockGuides);
    });

    it("allows a fresh request once the in-flight one settles", async () => {
      mockApiFetch.mockResolvedValue({ guides: [], page: 1, hasMore: false });
      const store = useGuidesStore();

      await store.fetchGuides();
      await store.fetchGuides();

      expect(mockApiFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchGuideById
  // ---------------------------------------------------------------------------

  describe("fetchGuideById", () => {
    const guide = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };

    it("populates currentGuide on success", async () => {
      mockApiFetch.mockResolvedValueOnce(guide);
      const store = useGuidesStore();

      await store.fetchGuideById("g-1");

      expect(store.currentGuide).toEqual(guide);
      expect(store.isLoadingGuide).toBe(false);
      expect(store.guideError).toBeNull();
    });

    it("calls GET /api/guides/:id", async () => {
      mockApiFetch.mockResolvedValue(guide);
      const store = useGuidesStore();

      await store.fetchGuideById("g-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/guides/g-1");
    });

    it("sets guideError, clears currentGuide, and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Not Found"));
      const store = useGuidesStore();

      await expect(store.fetchGuideById("g-1")).rejects.toThrow("Not Found");

      expect(store.currentGuide).toBeNull();
      expect(store.guideError).toBe("Not Found");
      expect(store.isLoadingGuide).toBe(false);
    });

    it("sets guideNotFound (not guideError) on a 404, so the page renders not-found rather than a retry prompt", async () => {
      const notFoundError = Object.assign(new Error("Not Found"), {
        statusCode: 404,
      });
      mockApiFetch.mockRejectedValue(notFoundError);
      const store = useGuidesStore();

      await expect(store.fetchGuideById("g-missing")).rejects.toThrow();

      expect(store.currentGuide).toBeNull();
      expect(store.guideNotFound).toBe(true);
      expect(store.guideError).toBeNull();
    });

    it("sets guideError (not guideNotFound) on a 401, since apiFetch mints a fresh token per call so retrying can fix it", async () => {
      // server/middleware/auth.ts 401s a request that sends a token that
      // fails verification (e.g. expired in flight); unlike a 404 (genuinely
      // gone/private, not fixable by retrying), a fresh token on the next
      // call can resolve this, so it belongs in the retryable bucket.
      const unauthorizedError = Object.assign(new Error("Unauthorized"), {
        statusCode: 401,
      });
      mockApiFetch.mockRejectedValue(unauthorizedError);
      const store = useGuidesStore();

      await expect(store.fetchGuideById("g-1")).rejects.toThrow();

      expect(store.currentGuide).toBeNull();
      expect(store.guideNotFound).toBe(false);
      expect(store.guideError).toBe("Unauthorized");
    });

    it("sets guideError (not guideNotFound) on a 5xx, so a share-link visitor sees a retryable error instead of not-found", async () => {
      const serverError = Object.assign(new Error("Internal Server Error"), {
        statusCode: 500,
      });
      mockApiFetch.mockRejectedValue(serverError);
      const store = useGuidesStore();

      await expect(store.fetchGuideById("g-1")).rejects.toThrow();

      expect(store.currentGuide).toBeNull();
      expect(store.guideNotFound).toBe(false);
      expect(store.guideError).toBe("Internal Server Error");
    });

    it("sets guideError (not guideNotFound) on a network failure with no status code", async () => {
      mockApiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
      const store = useGuidesStore();

      await expect(store.fetchGuideById("g-1")).rejects.toThrow();

      expect(store.guideNotFound).toBe(false);
      expect(store.guideError).toBe("Failed to fetch");
    });

    it("keeps the already-displayed guide when a retryable background refetch of the SAME id fails", async () => {
      mockApiFetch.mockResolvedValueOnce(guide);
      const store = useGuidesStore();
      await store.fetchGuideById("g-1");
      expect(store.currentGuide).toEqual(guide);

      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Internal Server Error"), {
          statusCode: 500,
        }),
      );
      await expect(store.fetchGuideById("g-1")).rejects.toThrow();

      expect(store.currentGuide).toEqual(guide);
      expect(store.guideError).toBe("Internal Server Error");
    });

    it("clears a stale guide on failure when nothing valid is displayed for the requested id", async () => {
      mockApiFetch.mockResolvedValueOnce(guide);
      const store = useGuidesStore();
      await store.fetchGuideById("g-1");
      expect(store.currentGuide).not.toBeNull();

      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Internal Server Error"), {
          statusCode: 500,
        }),
      );
      await expect(store.fetchGuideById("g-2")).rejects.toThrow();

      expect(store.currentGuide).toBeNull();
    });

    it("clears the already-displayed guide on a 404 even when it was loaded for the same id", async () => {
      // Unlike a retryable failure, a 404 means the guide is genuinely gone
      // or the owner made it private, so it must not keep showing stale
      // content. Mirrors the equivalent trips.test.ts case.
      mockApiFetch.mockResolvedValueOnce(guide);
      const store = useGuidesStore();
      await store.fetchGuideById("g-1");
      expect(store.currentGuide).not.toBeNull();

      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Not Found"), { statusCode: 404 }),
      );
      await expect(store.fetchGuideById("g-1")).rejects.toThrow();

      expect(store.currentGuide).toBeNull();
      expect(store.guideNotFound).toBe(true);
    });

    it("drops a stale response so an older request can't overwrite a newer guide", async () => {
      const slowGuide = { ...guide, id: "g-slow", title: "Slow" };
      const fastGuide = { ...guide, id: "g-fast", title: "Fast" };

      let resolveSlow: (value: typeof slowGuide) => void;
      mockApiFetch
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSlow = resolve;
            }),
        )
        .mockResolvedValueOnce(fastGuide);

      const store = useGuidesStore();
      const slow = store.fetchGuideById("g-slow");
      await store.fetchGuideById("g-fast");

      // The slower first request lands last but must not clobber g-fast.
      resolveSlow!(slowGuide);
      await slow;

      expect(store.currentGuide).toEqual(fastGuide);
    });

    it("does not clobber a newer same-id request when an older one fails late", async () => {
      const loadedGuide = { ...guide, title: "Loaded" };

      let rejectFirst: (reason: Error) => void;
      mockApiFetch
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectFirst = reject;
            }),
        )
        .mockResolvedValueOnce(loadedGuide);

      const store = useGuidesStore();
      // Two in-flight requests for the SAME id (e.g. back/forward to /guides/g-1).
      const first = store.fetchGuideById("g-1");
      await store.fetchGuideById("g-1");

      // The first (now superseded) request rejects after the second succeeded.
      rejectFirst!(new Error("late failure"));
      await expect(first).rejects.toThrow("late failure");

      // The late failure must not blank the guide or surface an error.
      expect(store.currentGuide).toEqual(loadedGuide);
      expect(store.guideError).toBeNull();
    });

    it("keeps isLoadingGuide true when an older request settles while a newer one is still in flight", async () => {
      let resolveFirst: (value: typeof guide) => void;
      mockApiFetch
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        // The second request never settles, so the spinner must stay on.
        .mockImplementationOnce(() => new Promise(() => {}));

      const store = useGuidesStore();
      const first = store.fetchGuideById("g-1");
      store.fetchGuideById("g-2");

      resolveFirst!(guide);
      await first;

      expect(store.isLoadingGuide).toBe(true);
      expect(store.currentGuide).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // createGuide
  // ---------------------------------------------------------------------------

  describe("createGuide", () => {
    it("creates a guide and prepends it to the list", async () => {
      const newGuide = {
        id: "g-new",
        userId: "u-1",
        title: "Paris in a weekend",
        body: null,
        readTimeMinutes: 5,
        likeCount: 0,
        visibility: "private",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // hasLoaded starts false, so createGuide's markLoadSucceeded triggers a
      // refetch (see the "refetches instead of trusting the local list" test
      // below) — queue its response too, alongside the create response.
      mockApiFetch
        .mockResolvedValueOnce(newGuide) // POST /api/guides
        .mockResolvedValueOnce({ guides: [newGuide], page: 1, hasMore: false }); // refetch GET /api/guides

      const store = useGuidesStore();
      const result = await store.createGuide({ title: "Paris in a weekend" });

      expect(result).toEqual(newGuide);
      expect(store.guides).toEqual([newGuide]);
    });

    it("calls POST /api/guides with the input body", async () => {
      const newGuide = { id: "g-1", userId: "u-1", title: "Paris" };
      mockApiFetch
        .mockResolvedValueOnce(newGuide) // POST /api/guides
        .mockResolvedValueOnce({ guides: [newGuide], page: 1, hasMore: false }); // refetch GET /api/guides

      const store = useGuidesStore();
      await store.createGuide({ title: "Paris", readTimeMinutes: 6 });

      expect(mockApiFetch).toHaveBeenCalledWith("/api/guides", {
        method: "POST",
        body: { title: "Paris", readTimeMinutes: 6 },
      });
    });

    it("prepends to existing guides so the newest guide is first", async () => {
      const existing = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };
      const created = { id: "g-2", userId: "u-1", title: "Paris" };

      mockApiFetch
        .mockResolvedValueOnce({ guides: [existing], page: 1, hasMore: false })
        .mockResolvedValueOnce(created);

      const store = useGuidesStore();
      await store.fetchGuides();
      await store.createGuide({ title: "Paris" });

      expect(store.guides).toHaveLength(2);
      expect(store.guides[0]).toEqual(created);
      expect(store.guides[1]).toEqual(existing);
    });

    it("leaves the list untouched and rethrows when the request fails", async () => {
      const existing = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };
      mockApiFetch
        .mockResolvedValueOnce({ guides: [existing], page: 1, hasMore: false })
        .mockRejectedValueOnce(new Error("boom"));

      const store = useGuidesStore();
      await store.fetchGuides();

      await expect(store.createGuide({ title: "Paris" })).rejects.toThrow(
        "boom",
      );
      expect(store.guides).toEqual([existing]);
    });

    it("clears a stale load error on a successful create", async () => {
      const created = { id: "g-1", userId: "u-1", title: "Paris" };
      mockApiFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(created)
        .mockResolvedValueOnce({ guides: [created], page: 1, hasMore: false });

      const store = useGuidesStore();
      await expect(store.fetchGuides()).rejects.toThrow("Network error");
      expect(store.error).toBe("Network error");

      await store.createGuide({ title: "Paris" });

      expect(store.error).toBeNull();
    });

    it("refetches instead of trusting the local list when the initial load never succeeded", async () => {
      // hasLoaded is still false here (no prior successful fetchGuides), so
      // `guides` being `[]` doesn't mean the user has no guides — it means
      // they were never loaded. A create must not let the optimistic
      // [created, ...[]] stand in as the complete list.
      const created = { id: "g-new", userId: "u-1", title: "Paris" };
      const created2 = { id: "g-2", userId: "u-1", title: "Tokyo" };
      mockApiFetch
        .mockResolvedValueOnce(created) // POST /api/guides
        .mockResolvedValueOnce({
          guides: [created2, created],
          page: 1,
          hasMore: false,
        }); // refetch GET /api/guides

      const store = useGuidesStore();
      expect(store.hasLoaded).toBe(false);

      await store.createGuide({ title: "Paris" });

      expect(mockApiFetch).toHaveBeenCalledTimes(2);
      expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/api/guides?page=1");
      expect(store.hasLoaded).toBe(true);
      expect(store.guides).toEqual([created2, created]);
    });

    it("surfaces the refetch error instead of falsely marking the store loaded", async () => {
      const created = { id: "g-new", userId: "u-1", title: "Paris" };
      mockApiFetch
        .mockResolvedValueOnce(created) // POST /api/guides succeeds
        .mockRejectedValueOnce(new Error("refetch failed")); // GET /api/guides fails

      const store = useGuidesStore();

      await store.createGuide({ title: "Paris" });

      expect(store.hasLoaded).toBe(false);
      expect(store.error).toBe("refetch failed");
    });
  });

  // ---------------------------------------------------------------------------
  // updateGuide
  // ---------------------------------------------------------------------------

  describe("updateGuide", () => {
    it("updates the guide in the list", async () => {
      const original = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };
      const updated = { id: "g-1", userId: "u-1", title: "Tokyo, revised" };

      mockApiFetch
        .mockResolvedValueOnce({ guides: [original], page: 1, hasMore: false })
        .mockResolvedValueOnce(updated);

      const store = useGuidesStore();
      await store.fetchGuides();
      const result = await store.updateGuide("g-1", {
        title: "Tokyo, revised",
      });

      expect(result).toEqual(updated);
      expect(store.guides).toHaveLength(1);
      expect(store.guides[0]).toEqual(updated);
    });

    it("calls PATCH /api/guides/:id with the input body", async () => {
      const updated = { id: "g-1", userId: "u-1", title: "Osaka" };
      mockApiFetch
        .mockResolvedValueOnce(updated) // PATCH /api/guides/:id
        .mockResolvedValueOnce({ guides: [updated], page: 1, hasMore: false }); // refetch GET /api/guides

      const store = useGuidesStore();
      await store.updateGuide("g-1", { title: "Osaka", visibility: "public" });

      expect(mockApiFetch).toHaveBeenCalledWith("/api/guides/g-1", {
        method: "PATCH",
        body: { title: "Osaka", visibility: "public" },
      });
    });

    it("leaves other guides untouched", async () => {
      const guide1 = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };
      const guide2 = { id: "g-2", userId: "u-1", title: "Slow coastlines" };
      const updatedGuide1 = { id: "g-1", userId: "u-1", title: "Tokyo redo" };

      mockApiFetch
        .mockResolvedValueOnce({
          guides: [guide1, guide2],
          page: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce(updatedGuide1);

      const store = useGuidesStore();
      await store.fetchGuides();
      await store.updateGuide("g-1", { title: "Tokyo redo" });

      expect(store.guides).toHaveLength(2);
      expect(store.guides[0]).toEqual(updatedGuide1);
      expect(store.guides[1]).toEqual(guide2);
    });

    it("leaves the list untouched and rethrows when the request fails", async () => {
      const guide1 = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };
      mockApiFetch
        .mockResolvedValueOnce({ guides: [guide1], page: 1, hasMore: false })
        .mockRejectedValueOnce(new Error("boom"));

      const store = useGuidesStore();
      await store.fetchGuides();

      await expect(
        store.updateGuide("g-1", { title: "New title" }),
      ).rejects.toThrow("boom");
      expect(store.guides).toEqual([guide1]);
    });

    it("syncs the open detail guide when it is the one edited", async () => {
      const original = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };
      const updated = { id: "g-1", userId: "u-1", title: "Tokyo, revised" };

      mockApiFetch
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(updated)
        // markLoadSucceeded refetches the list because fetchGuideById never
        // set hasLoaded — give that call a clean empty response.
        .mockResolvedValue([]);

      const store = useGuidesStore();
      await store.fetchGuideById("g-1");
      await store.updateGuide("g-1", { title: "Tokyo, revised" });

      expect(store.currentGuide).toEqual(updated);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteGuide
  // ---------------------------------------------------------------------------

  describe("deleteGuide", () => {
    it("removes the guide from the list", async () => {
      const guide1 = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };
      const guide2 = { id: "g-2", userId: "u-1", title: "Slow coastlines" };

      mockApiFetch
        .mockResolvedValueOnce({
          guides: [guide1, guide2],
          page: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce({ success: true });

      const store = useGuidesStore();
      await store.fetchGuides();
      await store.deleteGuide("g-1");

      expect(store.guides).toHaveLength(1);
      expect(store.guides[0]).toEqual(guide2);
    });

    it("calls DELETE /api/guides/:id", async () => {
      mockApiFetch
        .mockResolvedValueOnce({ success: true }) // DELETE /api/guides/:id
        .mockResolvedValueOnce({ guides: [], page: 1, hasMore: false }); // refetch GET /api/guides

      const store = useGuidesStore();
      await store.deleteGuide("g-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/guides/g-1", {
        method: "DELETE",
      });
    });

    it("leaves the list untouched and rethrows when the request fails", async () => {
      const guide1 = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };
      mockApiFetch
        .mockResolvedValueOnce({ guides: [guide1], page: 1, hasMore: false })
        .mockRejectedValueOnce(new Error("boom"));

      const store = useGuidesStore();
      await store.fetchGuides();

      await expect(store.deleteGuide("g-1")).rejects.toThrow("boom");
      expect(store.guides).toEqual([guide1]);
    });

    it("clears the open detail guide when it is the one deleted", async () => {
      const guide1 = { id: "g-1", userId: "u-1", title: "Tokyo on foot" };

      mockApiFetch
        .mockResolvedValueOnce(guide1)
        .mockResolvedValueOnce({ success: true })
        // markLoadSucceeded refetches the list because fetchGuideById never
        // set hasLoaded — give that call a clean empty response.
        .mockResolvedValue([]);

      const store = useGuidesStore();
      await store.fetchGuideById("g-1");
      await store.deleteGuide("g-1");

      expect(store.currentGuide).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // likeGuide
  // ---------------------------------------------------------------------------

  describe("likeGuide", () => {
    it("increments likeCount in the list", async () => {
      const guide = { id: "g-1", userId: "u-1", title: "Tokyo", likeCount: 0 };
      const liked = { ...guide, likeCount: 1 };
      mockApiFetch
        .mockResolvedValueOnce({ guides: [guide], page: 1, hasMore: false })
        .mockResolvedValueOnce(liked);

      const store = useGuidesStore();
      await store.fetchGuides();

      const result = await store.likeGuide("g-1");

      expect(result).toEqual(liked);
      expect(store.guides[0].likeCount).toBe(1);
    });

    it("calls POST /api/guides/:id/like", async () => {
      const liked = { id: "g-1", userId: "u-1", title: "Tokyo", likeCount: 1 };
      mockApiFetch.mockResolvedValue(liked);

      const store = useGuidesStore();
      await store.likeGuide("g-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/guides/g-1/like", {
        method: "POST",
      });
    });

    it("rethrows when the request fails", async () => {
      mockApiFetch.mockRejectedValueOnce(new Error("Not found"));

      const store = useGuidesStore();

      await expect(store.likeGuide("missing")).rejects.toThrow("Not found");
    });
  });

  // ---------------------------------------------------------------------------
  // unlikeGuide
  // ---------------------------------------------------------------------------

  describe("unlikeGuide", () => {
    it("decrements likeCount in the list", async () => {
      const guide = { id: "g-1", userId: "u-1", title: "Tokyo", likeCount: 1 };
      const unliked = { ...guide, likeCount: 0 };
      mockApiFetch
        .mockResolvedValueOnce({ guides: [guide], page: 1, hasMore: false })
        .mockResolvedValueOnce(unliked);

      const store = useGuidesStore();
      await store.fetchGuides();

      const result = await store.unlikeGuide("g-1");

      expect(result).toEqual(unliked);
      expect(store.guides[0].likeCount).toBe(0);
    });

    it("calls DELETE /api/guides/:id/like", async () => {
      const unliked = {
        id: "g-1",
        userId: "u-1",
        title: "Tokyo",
        likeCount: 0,
      };
      mockApiFetch.mockResolvedValue(unliked);

      const store = useGuidesStore();
      await store.unlikeGuide("g-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/guides/g-1/like", {
        method: "DELETE",
      });
    });

    it("rethrows when the request fails", async () => {
      mockApiFetch.mockRejectedValueOnce(new Error("Not found"));

      const store = useGuidesStore();

      await expect(store.unlikeGuide("missing")).rejects.toThrow("Not found");
    });
  });
});
