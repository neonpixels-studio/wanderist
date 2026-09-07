import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEntryDraft } from "~/composables/useEntryDraft";
import type { EntryDraft } from "~/composables/useEntryDraft";

const DRAFT_STORAGE_KEY = "wanderist:new-entry-draft";

const SAMPLE_DRAFT: EntryDraft = {
  title: "Harbor at 4am",
  body: "Cold morning",
  location: "Reykjavík",
  tripId: "trip-1",
  date: "2026-06-14",
  visibility: "private",
  tags: ["iceland"],
  weather: "clear",
  uploadedPhotos: [{ id: "media-1", url: "https://example.com/photo.jpg" }],
};

describe("useEntryDraft", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("saveDraft", () => {
    it("persists the draft to localStorage", () => {
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(SAMPLE_DRAFT);
    });

    it("overwrites a previously saved draft", () => {
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      const updated = { ...SAMPLE_DRAFT, title: "Updated title" };
      saveDraft(updated);
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      expect(JSON.parse(stored!).title).toBe("Updated title");
    });
  });

  describe("loadDraft", () => {
    it("returns null when no draft is stored", () => {
      const { loadDraft } = useEntryDraft();
      expect(loadDraft()).toBeNull();
    });

    it("returns the stored draft when one exists", () => {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(SAMPLE_DRAFT));
      const { loadDraft } = useEntryDraft();
      expect(loadDraft()).toEqual(SAMPLE_DRAFT);
    });

    it("returns null and removes the key when storage is corrupt", () => {
      localStorage.setItem(DRAFT_STORAGE_KEY, "not-valid-json{{{");
      const { loadDraft } = useEntryDraft();
      const result = loadDraft();
      expect(result).toBeNull();
      expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    });

    it("returns null and removes the key when storage parses to a non-object", () => {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(null));
      const { loadDraft } = useEntryDraft();
      const result = loadDraft();
      expect(result).toBeNull();
      expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    });

    it("returns null and removes the key when storage parses to an array", () => {
      // typeof [] === "object" and { ...[] } is {}, so an array must be rejected
      // explicitly or it would silently pass through as an empty-ish draft.
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify([]));
      const { loadDraft } = useEntryDraft();
      const result = loadDraft();
      expect(result).toBeNull();
      expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    });

    describe("required field validation", () => {
      it.each(["title", "body", "location", "tripId", "weather"] as const)(
        "returns null and removes the key when %s is missing",
        (field) => {
          const corrupted = { ...SAMPLE_DRAFT };
          delete (corrupted as Record<string, unknown>)[field];
          localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
          const { loadDraft } = useEntryDraft();
          expect(loadDraft()).toBeNull();
          expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
        },
      );

      it("returns null and removes the key when tags is not an array", () => {
        const corrupted = { ...SAMPLE_DRAFT, tags: "iceland" };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()).toBeNull();
        expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
      });

      it("returns null and removes the key when visibility is not a recognized value", () => {
        const corrupted = { ...SAMPLE_DRAFT, visibility: "everyone" };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()).toBeNull();
        expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
      });
    });

    describe("date normalization", () => {
      it("keeps a valid restored date untouched", () => {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(SAMPLE_DRAFT));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("2026-06-14");
      });

      it("clears the date when it is a malformed string", () => {
        const corrupted = { ...SAMPLE_DRAFT, date: "not-a-date" };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("");
      });

      it("clears the date when it overflows its month", () => {
        const corrupted = { ...SAMPLE_DRAFT, date: "2026-02-31" };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("");
      });

      it("clears the date when it is missing", () => {
        const { date: _date, ...withoutDate } = SAMPLE_DRAFT;
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(withoutDate));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("");
      });

      it("clears the date when it is the wrong type", () => {
        const corrupted = { ...SAMPLE_DRAFT, date: 20260614 };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("");
      });

      it("preserves the rest of the draft when only the date is normalized", () => {
        const corrupted = { ...SAMPLE_DRAFT, date: "not-a-date" };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        const result = loadDraft();
        expect(result?.title).toBe(SAMPLE_DRAFT.title);
        expect(result?.body).toBe(SAMPLE_DRAFT.body);
      });
    });
  });

  describe("clearDraft", () => {
    it("removes the draft from localStorage", () => {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(SAMPLE_DRAFT));
      const { clearDraft } = useEntryDraft();
      clearDraft();
      expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    });

    it("does not throw when no draft exists", () => {
      const { clearDraft } = useEntryDraft();
      expect(() => clearDraft()).not.toThrow();
    });
  });
});
