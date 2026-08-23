import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApiFetch = vi.fn();
vi.stubGlobal("useApiClient", () => ({ apiFetch: mockApiFetch }));

const { createPinia, setActivePinia, defineStore } = await import("pinia");
const { ref } = await import("vue");
vi.stubGlobal("ref", ref);
vi.stubGlobal("defineStore", defineStore);

const { useEntriesStore } = await import("../entries");

const BASE_ENTRY = {
  id: "e-1",
  userId: "u-1",
  tripId: null,
  placeId: null,
  title: "Test Entry",
  body: null,
  occurredAt: null,
  visibility: "private" as const,
  weather: null,
  likeCount: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  photos: [],
  tags: [],
};

describe("useEntriesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // resetAllMocks (not clearAllMocks) so a persistent mockResolvedValue set by
    // one test — e.g. the "hasMore forever" case — cannot leak its implementation
    // into a later test that forgets to set its own.
    vi.resetAllMocks();
  });

  // ---------------------------------------------------------------------------
  // fetchEntries
  // ---------------------------------------------------------------------------

  describe("fetchEntries", () => {
    it("populates entries on success", async () => {
      const mockEntries = [
        BASE_ENTRY,
        { ...BASE_ENTRY, id: "e-2", title: "Second" },
      ];
      mockApiFetch.mockResolvedValue({
        entries: mockEntries,
        tab: "timeline",
        page: 1,
        hasMore: false,
      });

      const store = useEntriesStore();
      await store.fetchEntries();

      expect(store.entries).toEqual(mockEntries);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("walks every page and concatenates entries when hasMore is true", async () => {
      const pageOne = Array.from({ length: 20 }, (_, index) => ({
        ...BASE_ENTRY,
        id: `p1-${index}`,
      }));
      const pageTwo = Array.from({ length: 5 }, (_, index) => ({
        ...BASE_ENTRY,
        id: `p2-${index}`,
      }));

      mockApiFetch
        .mockResolvedValueOnce({
          entries: pageOne,
          tab: "timeline",
          page: 1,
          hasMore: true,
        })
        .mockResolvedValueOnce({
          entries: pageTwo,
          tab: "timeline",
          page: 2,
          hasMore: false,
        });

      const store = useEntriesStore();
      await store.fetchEntries();

      expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/api/entries?page=1");
      expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/api/entries?page=2");
      expect(store.entries).toHaveLength(25);
      expect(store.entries[24].id).toBe("p2-4");
    });

    it("carries the filters onto every walked page, not just the first", async () => {
      mockApiFetch
        .mockResolvedValueOnce({
          entries: Array.from({ length: 20 }, (_, index) => ({
            ...BASE_ENTRY,
            id: `p1-${index}`,
          })),
          tab: "by-trip",
          page: 1,
          hasMore: true,
        })
        .mockResolvedValueOnce({
          entries: [BASE_ENTRY],
          tab: "by-trip",
          page: 2,
          hasMore: false,
        });

      const store = useEntriesStore();
      await store.fetchEntries({ tripId: "trip-1", tab: "by-trip" });

      expect(mockApiFetch).toHaveBeenNthCalledWith(
        1,
        "/api/entries?tripId=trip-1&tab=by-trip&page=1",
      );
      expect(mockApiFetch).toHaveBeenNthCalledWith(
        2,
        "/api/entries?tripId=trip-1&tab=by-trip&page=2",
      );
    });

    it("throws when the API keeps reporting hasMore forever", async () => {
      mockApiFetch.mockResolvedValue({
        entries: [BASE_ENTRY],
        tab: "timeline",
        page: 1,
        hasMore: true,
      });

      const store = useEntriesStore();

      await expect(store.fetchEntries()).rejects.toThrow(/exceeded 500 pages/);
      expect(store.error).toMatch(/exceeded 500 pages/);
      expect(store.isLoading).toBe(false);
      // Fail loud rather than expose a truncated list dressed up as the full one.
      expect(store.entries).toEqual([]);
      // Pins the cap boundary: pages 1..500 are fetched, then the 501st request
      // is refused. A `>=` off-by-one would show up here as 499.
      expect(mockApiFetch).toHaveBeenCalledTimes(500);
    });

    it("throws on a malformed response missing hasMore", async () => {
      mockApiFetch.mockResolvedValue({ entries: [], tab: "timeline", page: 1 });
      const store = useEntriesStore();

      await expect(store.fetchEntries()).rejects.toThrow(
        /Malformed \/api\/entries response/,
      );
      expect(store.error).toMatch(/Malformed \/api\/entries response/);
      expect(store.isLoading).toBe(false);
    });

    it("throws on a malformed response whose entries is not an array", async () => {
      mockApiFetch.mockResolvedValue({
        entries: null,
        tab: "timeline",
        page: 1,
        hasMore: false,
      });
      const store = useEntriesStore();

      await expect(store.fetchEntries()).rejects.toThrow(
        /Malformed \/api\/entries response/,
      );
      expect(store.error).toMatch(/Malformed \/api\/entries response/);
      expect(store.isLoading).toBe(false);
    });

    it("preserves the existing list when a later page fails mid-walk", async () => {
      const seeded = [{ ...BASE_ENTRY, id: "seed-1" }];
      const firstPage = Array.from({ length: 20 }, (_, index) => ({
        ...BASE_ENTRY,
        id: `p1-${index}`,
      }));

      // Seed a known list via a first successful single-page fetch, then make
      // the next fetch fail on its second page.
      mockApiFetch.mockResolvedValueOnce({
        entries: seeded,
        tab: "timeline",
        page: 1,
        hasMore: false,
      });

      const store = useEntriesStore();
      await store.fetchEntries();
      expect(store.entries).toEqual(seeded);

      mockApiFetch
        .mockResolvedValueOnce({
          entries: firstPage,
          tab: "timeline",
          page: 1,
          hasMore: true,
        })
        .mockRejectedValueOnce(new Error("page 2 failed"));

      await expect(store.fetchEntries()).rejects.toThrow("page 2 failed");

      // A mid-walk failure must not leave the store holding a truncated list —
      // the prior contents survive and the error surfaces.
      expect(store.entries).toEqual(seeded);
      expect(store.error).toBe("page 2 failed");
      expect(store.isLoading).toBe(false);
    });

    it("sets isLoading true during fetch and resets after", async () => {
      let capturedLoading = false;
      const store = useEntriesStore();

      mockApiFetch.mockImplementation(async () => {
        capturedLoading = store.isLoading;
        return { entries: [], tab: "timeline", page: 1, hasMore: false };
      });

      await store.fetchEntries();

      expect(capturedLoading).toBe(true);
      expect(store.isLoading).toBe(false);
    });

    it("sets error and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Network error"));
      const store = useEntriesStore();

      await expect(store.fetchEntries()).rejects.toThrow("Network error");

      expect(store.error).toBe("Network error");
      expect(store.isLoading).toBe(false);
    });

    it("requests page 1 with no other query when no filters", async () => {
      mockApiFetch.mockResolvedValue({
        entries: [],
        tab: "timeline",
        page: 1,
        hasMore: false,
      });
      const store = useEntriesStore();
      await store.fetchEntries();

      expect(mockApiFetch).toHaveBeenCalledWith("/api/entries?page=1");
    });

    it("appends tripId query param when provided", async () => {
      mockApiFetch.mockResolvedValue({
        entries: [],
        tab: "timeline",
        page: 1,
        hasMore: false,
      });
      const store = useEntriesStore();
      await store.fetchEntries({ tripId: "trip-1" });

      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/entries?tripId=trip-1&page=1",
      );
    });

    it("appends placeId query param when provided", async () => {
      mockApiFetch.mockResolvedValue({
        entries: [],
        tab: "timeline",
        page: 1,
        hasMore: false,
      });
      const store = useEntriesStore();
      await store.fetchEntries({ placeId: "place-1" });

      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/entries?placeId=place-1&page=1",
      );
    });

    it("appends tab query param when provided", async () => {
      mockApiFetch.mockResolvedValue({
        entries: [],
        tab: "photos",
        page: 1,
        hasMore: false,
      });
      const store = useEntriesStore();
      await store.fetchEntries({ tab: "photos" });

      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/entries?tab=photos&page=1",
      );
    });

    it("combines multiple filters", async () => {
      mockApiFetch.mockResolvedValue({
        entries: [],
        tab: "by-trip",
        page: 1,
        hasMore: false,
      });
      const store = useEntriesStore();
      await store.fetchEntries({ tripId: "trip-1", tab: "by-trip" });

      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/entries?tripId=trip-1&tab=by-trip&page=1",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // fetchEntry
  // ---------------------------------------------------------------------------

  describe("fetchEntry", () => {
    it("returns a single entry by id", async () => {
      mockApiFetch.mockResolvedValue(BASE_ENTRY);
      const store = useEntriesStore();
      const result = await store.fetchEntry("e-1");

      expect(result).toEqual(BASE_ENTRY);
      expect(mockApiFetch).toHaveBeenCalledWith("/api/entries/e-1");
    });

    it("sets error and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Not found"));
      const store = useEntriesStore();

      await expect(store.fetchEntry("missing")).rejects.toThrow("Not found");
      expect(store.error).toBe("Not found");
    });
  });

  // ---------------------------------------------------------------------------
  // createEntry
  // ---------------------------------------------------------------------------

  describe("createEntry", () => {
    it("creates an entry and prepends it to the list", async () => {
      mockApiFetch.mockResolvedValue(BASE_ENTRY);

      const store = useEntriesStore();
      const result = await store.createEntry({ title: "Test Entry" });

      expect(result).toEqual(BASE_ENTRY);
      expect(store.entries).toEqual([BASE_ENTRY]);
    });

    it("calls POST /api/entries with the input body", async () => {
      mockApiFetch.mockResolvedValue(BASE_ENTRY);
      const store = useEntriesStore();
      const input = { title: "Test", body: "Some content", weather: "Sunny" };
      await store.createEntry(input);

      expect(mockApiFetch).toHaveBeenCalledWith("/api/entries", {
        method: "POST",
        body: input,
      });
    });

    it("prepends to existing entries so newest appears first", async () => {
      const second = { ...BASE_ENTRY, id: "e-2", title: "Second" };
      mockApiFetch
        .mockResolvedValueOnce({
          entries: [BASE_ENTRY],
          tab: "timeline",
          page: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce(second);

      const store = useEntriesStore();
      await store.fetchEntries();
      await store.createEntry({ title: "Second" });

      expect(store.entries).toHaveLength(2);
      expect(store.entries[0]).toEqual(second);
      expect(store.entries[1]).toEqual(BASE_ENTRY);
    });

    it("sets error and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Validation failed"));
      const store = useEntriesStore();

      await expect(store.createEntry({ title: "Bad" })).rejects.toThrow(
        "Validation failed",
      );
      expect(store.error).toBe("Validation failed");
    });
  });

  // ---------------------------------------------------------------------------
  // updateEntry
  // ---------------------------------------------------------------------------

  describe("updateEntry", () => {
    it("updates the entry in the list", async () => {
      const updated = { ...BASE_ENTRY, title: "Updated Title" };
      mockApiFetch
        .mockResolvedValueOnce({
          entries: [BASE_ENTRY],
          tab: "timeline",
          page: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce(updated);

      const store = useEntriesStore();
      await store.fetchEntries();
      const result = await store.updateEntry("e-1", { title: "Updated Title" });

      expect(result).toEqual(updated);
      expect(store.entries[0]).toEqual(updated);
    });

    it("calls PATCH /api/entries/:id with the input body", async () => {
      const updated = { ...BASE_ENTRY, title: "Updated" };
      mockApiFetch.mockResolvedValue(updated);

      const store = useEntriesStore();
      await store.updateEntry("e-1", { title: "Updated" });

      expect(mockApiFetch).toHaveBeenCalledWith("/api/entries/e-1", {
        method: "PATCH",
        body: { title: "Updated" },
      });
    });

    it("leaves other entries untouched", async () => {
      const entry2 = { ...BASE_ENTRY, id: "e-2", title: "Second" };
      const updatedEntry1 = { ...BASE_ENTRY, title: "Updated" };

      mockApiFetch
        .mockResolvedValueOnce({
          entries: [BASE_ENTRY, entry2],
          tab: "timeline",
          page: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce(updatedEntry1);

      const store = useEntriesStore();
      await store.fetchEntries();
      await store.updateEntry("e-1", { title: "Updated" });

      expect(store.entries).toHaveLength(2);
      expect(store.entries[0]).toEqual(updatedEntry1);
      expect(store.entries[1]).toEqual(entry2);
    });

    it("sets error and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Not found"));
      const store = useEntriesStore();

      await expect(
        store.updateEntry("missing", { title: "x" }),
      ).rejects.toThrow("Not found");
      expect(store.error).toBe("Not found");
    });
  });

  // ---------------------------------------------------------------------------
  // deleteEntry
  // ---------------------------------------------------------------------------

  describe("deleteEntry", () => {
    it("removes the entry from the list", async () => {
      const entry2 = { ...BASE_ENTRY, id: "e-2", title: "Second" };
      mockApiFetch
        .mockResolvedValueOnce({
          entries: [BASE_ENTRY, entry2],
          tab: "timeline",
          page: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce({ success: true });

      const store = useEntriesStore();
      await store.fetchEntries();
      await store.deleteEntry("e-1");

      expect(store.entries).toHaveLength(1);
      expect(store.entries[0]).toEqual(entry2);
    });

    it("calls DELETE /api/entries/:id", async () => {
      mockApiFetch.mockResolvedValue({ success: true });
      const store = useEntriesStore();
      await store.deleteEntry("e-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/entries/e-1", {
        method: "DELETE",
      });
    });

    it("sets error and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Forbidden"));
      const store = useEntriesStore();

      await expect(store.deleteEntry("e-1")).rejects.toThrow("Forbidden");
      expect(store.error).toBe("Forbidden");
    });
  });

  // ---------------------------------------------------------------------------
  // likeEntry
  // ---------------------------------------------------------------------------

  describe("likeEntry", () => {
    it("increments likeCount in the list", async () => {
      const liked = { ...BASE_ENTRY, likeCount: 1 };
      mockApiFetch
        .mockResolvedValueOnce({
          entries: [BASE_ENTRY],
          tab: "timeline",
          page: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce(liked);

      const store = useEntriesStore();
      await store.fetchEntries();
      const result = await store.likeEntry("e-1");

      expect(result).toEqual(liked);
      expect(store.entries[0].likeCount).toBe(1);
    });

    it("calls POST /api/entries/:id/like", async () => {
      const liked = { ...BASE_ENTRY, likeCount: 1 };
      mockApiFetch.mockResolvedValue(liked);
      const store = useEntriesStore();
      await store.likeEntry("e-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/entries/e-1/like", {
        method: "POST",
      });
    });

    it("sets error and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Not found"));
      const store = useEntriesStore();

      await expect(store.likeEntry("missing")).rejects.toThrow("Not found");
      expect(store.error).toBe("Not found");
    });
  });

  // ---------------------------------------------------------------------------
  // unlikeEntry
  // ---------------------------------------------------------------------------

  describe("unlikeEntry", () => {
    it("decrements likeCount in the list", async () => {
      const withLike = { ...BASE_ENTRY, likeCount: 1 };
      const unliked = { ...BASE_ENTRY, likeCount: 0 };

      mockApiFetch
        .mockResolvedValueOnce({
          entries: [withLike],
          tab: "timeline",
          page: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce(unliked);

      const store = useEntriesStore();
      await store.fetchEntries();
      const result = await store.unlikeEntry("e-1");

      expect(result).toEqual(unliked);
      expect(store.entries[0].likeCount).toBe(0);
    });

    it("calls DELETE /api/entries/:id/like", async () => {
      const unliked = { ...BASE_ENTRY, likeCount: 0 };
      mockApiFetch.mockResolvedValue(unliked);
      const store = useEntriesStore();
      await store.unlikeEntry("e-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/entries/e-1/like", {
        method: "DELETE",
      });
    });

    it("sets error and rethrows on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Not found"));
      const store = useEntriesStore();

      await expect(store.unlikeEntry("missing")).rejects.toThrow("Not found");
      expect(store.error).toBe("Not found");
    });
  });
});
