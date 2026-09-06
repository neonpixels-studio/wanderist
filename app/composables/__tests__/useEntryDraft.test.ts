import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vue from "vue";
import type { EntryDraft } from "../useEntryDraft";

// useClerkUser is a Nuxt auto-imported global; stub it before importing the
// composable so the module resolves cleanly (mirrors useApiClient.test.ts).
function installClerkUserStub(userId: string | null) {
  vi.stubGlobal("useClerkUser", () => ({
    user: vue.ref(userId ? { id: userId } : null),
  }));
}

installClerkUserStub(null);

const { useEntryDraft } = await import("../useEntryDraft");

const LEGACY_DRAFT_STORAGE_KEY = "wanderist:new-entry-draft";

function draftStorageKeyFor(userId: string | null): string {
  return `${LEGACY_DRAFT_STORAGE_KEY}:${userId ?? "anonymous"}`;
}

const SAMPLE_DRAFT: EntryDraft = {
  title: "Harbor at 4am",
  body: "Cold morning",
  location: "Reykjavík",
  tripId: "trip-1",
  date: "2026-06-14",
  visibility: "private" as const,
  tags: ["iceland"],
  weather: "clear",
  uploadedPhotos: [{ id: "media-1", url: "https://example.com/photo.jpg" }],
};

describe("useEntryDraft", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    installClerkUserStub(null);
  });

  describe("saveDraft", () => {
    it("persists the draft to localStorage under the current user's key", () => {
      installClerkUserStub("user-1");
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      const stored = localStorage.getItem(draftStorageKeyFor("user-1"));
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(SAMPLE_DRAFT);
    });

    it("overwrites a previously saved draft for the same user", () => {
      installClerkUserStub("user-1");
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      const updated = { ...SAMPLE_DRAFT, title: "Updated title" };
      saveDraft(updated);
      const stored = localStorage.getItem(draftStorageKeyFor("user-1"));
      expect(JSON.parse(stored!).title).toBe("Updated title");
    });

    it("saves under a distinct anonymous key when no user is signed in", () => {
      installClerkUserStub(null);
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      expect(localStorage.getItem(draftStorageKeyFor(null))).not.toBeNull();
    });
  });

  describe("loadDraft", () => {
    it("returns null when no draft is stored", () => {
      installClerkUserStub("user-1");
      const { loadDraft } = useEntryDraft();
      expect(loadDraft()).toBeNull();
    });

    it("returns the stored draft when one exists for the current user", () => {
      installClerkUserStub("user-1");
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );
      const { loadDraft } = useEntryDraft();
      expect(loadDraft()).toEqual(SAMPLE_DRAFT);
    });

    it("returns null and removes the key when storage is corrupt", () => {
      installClerkUserStub("user-1");
      localStorage.setItem(draftStorageKeyFor("user-1"), "not-valid-json{{{");
      const { loadDraft } = useEntryDraft();
      const result = loadDraft();
      expect(result).toBeNull();
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
    });

    it("isolates drafts between two different user ids", () => {
      installClerkUserStub("user-1");
      let { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);

      installClerkUserStub("user-2");
      ({ saveDraft } = useEntryDraft());
      const userTwoDraft = { ...SAMPLE_DRAFT, title: "User two's entry" };
      saveDraft(userTwoDraft);

      installClerkUserStub("user-1");
      let { loadDraft } = useEntryDraft();
      expect(loadDraft()?.title).toBe(SAMPLE_DRAFT.title);

      installClerkUserStub("user-2");
      ({ loadDraft } = useEntryDraft());
      expect(loadDraft()?.title).toBe("User two's entry");
    });

    it("does not read another user's draft while logged out", () => {
      installClerkUserStub("user-1");
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);

      installClerkUserStub(null);
      const { loadDraft } = useEntryDraft();
      expect(loadDraft()).toBeNull();
    });

    it("does not crash when a legacy unscoped draft key exists, and removes it", () => {
      localStorage.setItem(
        LEGACY_DRAFT_STORAGE_KEY,
        JSON.stringify(SAMPLE_DRAFT),
      );
      installClerkUserStub("user-1");
      const { loadDraft } = useEntryDraft();

      expect(() => loadDraft()).not.toThrow();
      expect(loadDraft()).toBeNull();
      expect(localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it("never surfaces a legacy draft as belonging to the current user", () => {
      localStorage.setItem(
        LEGACY_DRAFT_STORAGE_KEY,
        JSON.stringify(SAMPLE_DRAFT),
      );
      installClerkUserStub("user-1");
      const { loadDraft } = useEntryDraft();
      expect(loadDraft()).toBeNull();
    });
  });

  describe("clearDraft", () => {
    it("removes the current user's draft from localStorage", () => {
      installClerkUserStub("user-1");
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );
      const { clearDraft } = useEntryDraft();
      clearDraft();
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
    });

    it("does not throw when no draft exists", () => {
      installClerkUserStub("user-1");
      const { clearDraft } = useEntryDraft();
      expect(() => clearDraft()).not.toThrow();
    });

    it("does not remove a different user's draft", () => {
      installClerkUserStub("user-1");
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );
      localStorage.setItem(
        draftStorageKeyFor("user-2"),
        JSON.stringify(SAMPLE_DRAFT),
      );

      installClerkUserStub("user-2");
      const { clearDraft } = useEntryDraft();
      clearDraft();

      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).not.toBeNull();
      expect(localStorage.getItem(draftStorageKeyFor("user-2"))).toBeNull();
    });
  });
});
