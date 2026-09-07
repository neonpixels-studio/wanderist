import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vue from "vue";
import type { EntryDraft } from "../useEntryDraft";

// useClerkUser is a Nuxt auto-imported global; stub it before importing the
// composable so the module resolves cleanly (mirrors useApiClient.test.ts).
// isLoaded defaults to true (a resolved session) so tests that only care
// about the user id don't have to think about the loading flag.
function installClerkUserStub(userId: string | null, isLoaded: boolean = true) {
  vi.stubGlobal("useClerkUser", () => ({
    user: vue.ref(userId ? { id: userId } : null),
    isLoaded: vue.ref(isLoaded),
  }));
}

installClerkUserStub(null);

const { useEntryDraft } = await import("../useEntryDraft");

// The literal, historical key used before drafts were scoped per user.
// Deliberately not derived from the composable's current prefix constant, so
// this test can't drift in lockstep with a future rename and hide a mismatch.
const LEGACY_DRAFT_STORAGE_KEY = "wanderist:new-entry-draft";
const DRAFT_STORAGE_KEY_PREFIX = "wanderist:new-entry-draft";

function draftStorageKeyFor(userId: string): string {
  return `${DRAFT_STORAGE_KEY_PREFIX}:${userId}`;
}

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
    // restoreAllMocks does not undo vi.stubGlobal, so a test that forgets to
    // re-stub would otherwise silently inherit whatever the previous test
    // left behind. Clear it explicitly, then always re-install the default.
    vi.unstubAllGlobals();
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

    it("does not write anywhere when no user is signed in", () => {
      installClerkUserStub(null);
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      expect(localStorage.length).toBe(0);
    });

    it("does not write anywhere while the session hasn't resolved yet", () => {
      installClerkUserStub(null, false);
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      expect(localStorage.length).toBe(0);
    });

    it("uses the new user's key once the session resolves after setup", () => {
      const userRef = vue.ref<{ id: string } | null>(null);
      const isLoadedRef = vue.ref(false);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      expect(localStorage.length).toBe(0);

      isLoadedRef.value = true;
      userRef.value = { id: "user-1" };
      saveDraft(SAMPLE_DRAFT);

      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).not.toBeNull();
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

    it("does not read another user's draft while the session hasn't resolved yet", () => {
      installClerkUserStub("user-1");
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);

      installClerkUserStub(null, false);
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

      let result: EntryDraft | null = null;
      expect(() => {
        result = loadDraft();
      }).not.toThrow();
      expect(result).toBeNull();
      expect(localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).toBeNull();
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

    it("does not throw when no user is signed in", () => {
      installClerkUserStub(null);
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
