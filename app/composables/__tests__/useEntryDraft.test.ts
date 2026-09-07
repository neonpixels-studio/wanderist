import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

    describe("date normalization", () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-06T12:00:00.000Z"));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("keeps a valid restored date untouched", () => {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(SAMPLE_DRAFT));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("2026-06-14");
      });

      it("falls back to today when the restored date is a malformed string", () => {
        const corrupted = { ...SAMPLE_DRAFT, date: "not-a-date" };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("2026-09-06");
      });

      it("falls back to today when the restored date overflows its month", () => {
        const corrupted = { ...SAMPLE_DRAFT, date: "2026-02-31" };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("2026-09-06");
      });

      it("falls back to today when the restored date is missing", () => {
        const { date: _date, ...withoutDate } = SAMPLE_DRAFT;
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(withoutDate));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("2026-09-06");
      });

      it("falls back to today when the restored date is the wrong type", () => {
        const corrupted = { ...SAMPLE_DRAFT, date: 20260614 };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(corrupted));
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("2026-09-06");
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
