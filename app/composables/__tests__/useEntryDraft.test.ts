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

  // LEGACY_DRAFT_STORAGE_KEY and DRAFT_STORAGE_KEY_PREFIX are declared above
  // as two separately-literal strings that happen to share a value today (see
  // the comment on each). This pins the relationship down so an edit to one
  // without the other shows up as a failing assertion rather than silent drift.
  it("scopes the per-user key under the same literal as the legacy key", () => {
    expect(draftStorageKeyFor("user-1")).toBe(
      `${LEGACY_DRAFT_STORAGE_KEY}:user-1`,
    );
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

    it("leaves an existing legacy draft alone while logged out", () => {
      localStorage.setItem(
        LEGACY_DRAFT_STORAGE_KEY,
        JSON.stringify(SAMPLE_DRAFT),
      );
      installClerkUserStub(null);
      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      expect(localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).not.toBeNull();
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
      const { saveDraft: saveDraftAsUserOne, loadDraft: loadDraftAsUserOne } =
        useEntryDraft();
      saveDraftAsUserOne(SAMPLE_DRAFT);
      expect(loadDraftAsUserOne()?.title).toBe(SAMPLE_DRAFT.title);

      installClerkUserStub("user-2");
      const { saveDraft: saveDraftAsUserTwo, loadDraft: loadDraftAsUserTwo } =
        useEntryDraft();
      const userTwoDraft = { ...SAMPLE_DRAFT, title: "User two's entry" };
      saveDraftAsUserTwo(userTwoDraft);
      expect(loadDraftAsUserTwo()?.title).toBe("User two's entry");

      // Each user only ever reads/writes their own key while active — and
      // once user-2 is the active session, user-1's key isn't left behind
      // for whoever uses the browser next.
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
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

    it("leaves the legacy draft alone while logged out", () => {
      localStorage.setItem(
        LEGACY_DRAFT_STORAGE_KEY,
        JSON.stringify(SAMPLE_DRAFT),
      );
      installClerkUserStub(null);
      const { loadDraft } = useEntryDraft();
      expect(loadDraft()).toBeNull();
      expect(localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).not.toBeNull();
    });

    it("leaves the legacy draft alone while the session hasn't resolved yet", () => {
      localStorage.setItem(
        LEGACY_DRAFT_STORAGE_KEY,
        JSON.stringify(SAMPLE_DRAFT),
      );
      installClerkUserStub(null, false);
      const { loadDraft } = useEntryDraft();
      expect(loadDraft()).toBeNull();
      expect(localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).not.toBeNull();
    });

    it("returns null and removes the key when storage parses to a non-object", () => {
      installClerkUserStub("user-1");
      localStorage.setItem(draftStorageKeyFor("user-1"), JSON.stringify(null));
      const { loadDraft } = useEntryDraft();
      const result = loadDraft();
      expect(result).toBeNull();
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
    });

    it("returns null and removes the key when storage parses to an array", () => {
      // typeof [] === "object" and { ...[] } is {}, so an array must be rejected
      // explicitly or it would silently pass through as an empty-ish draft.
      installClerkUserStub("user-1");
      localStorage.setItem(draftStorageKeyFor("user-1"), JSON.stringify([]));
      const { loadDraft } = useEntryDraft();
      const result = loadDraft();
      expect(result).toBeNull();
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
    });

    describe("required field validation", () => {
      it.each(["title", "body", "location", "tripId", "weather"] as const)(
        "returns null and removes the key when %s is missing",
        (field) => {
          installClerkUserStub("user-1");
          const corrupted = { ...SAMPLE_DRAFT };
          delete (corrupted as Record<string, unknown>)[field];
          localStorage.setItem(
            draftStorageKeyFor("user-1"),
            JSON.stringify(corrupted),
          );
          const { loadDraft } = useEntryDraft();
          expect(loadDraft()).toBeNull();
          expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
        },
      );

      it("returns null and removes the key when tags is not an array", () => {
        installClerkUserStub("user-1");
        const corrupted = { ...SAMPLE_DRAFT, tags: "iceland" };
        localStorage.setItem(
          draftStorageKeyFor("user-1"),
          JSON.stringify(corrupted),
        );
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()).toBeNull();
        expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
      });

      it("returns null and removes the key when visibility is not a recognized value", () => {
        installClerkUserStub("user-1");
        const corrupted = { ...SAMPLE_DRAFT, visibility: "everyone" };
        localStorage.setItem(
          draftStorageKeyFor("user-1"),
          JSON.stringify(corrupted),
        );
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()).toBeNull();
        expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
      });
    });

    describe("date normalization", () => {
      it("keeps a valid restored date untouched", () => {
        installClerkUserStub("user-1");
        localStorage.setItem(
          draftStorageKeyFor("user-1"),
          JSON.stringify(SAMPLE_DRAFT),
        );
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("2026-06-14");
      });

      it("clears the date when it is a malformed string", () => {
        installClerkUserStub("user-1");
        const corrupted = { ...SAMPLE_DRAFT, date: "not-a-date" };
        localStorage.setItem(
          draftStorageKeyFor("user-1"),
          JSON.stringify(corrupted),
        );
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("");
      });

      it("clears the date when it overflows its month", () => {
        installClerkUserStub("user-1");
        const corrupted = { ...SAMPLE_DRAFT, date: "2026-02-31" };
        localStorage.setItem(
          draftStorageKeyFor("user-1"),
          JSON.stringify(corrupted),
        );
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("");
      });

      it("clears the date when it is missing", () => {
        installClerkUserStub("user-1");
        const { date: _date, ...withoutDate } = SAMPLE_DRAFT;
        localStorage.setItem(
          draftStorageKeyFor("user-1"),
          JSON.stringify(withoutDate),
        );
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("");
      });

      it("clears the date when it is the wrong type", () => {
        installClerkUserStub("user-1");
        const corrupted = { ...SAMPLE_DRAFT, date: 20260614 };
        localStorage.setItem(
          draftStorageKeyFor("user-1"),
          JSON.stringify(corrupted),
        );
        const { loadDraft } = useEntryDraft();
        expect(loadDraft()?.date).toBe("");
      });

      it("preserves the rest of the draft when only the date is normalized", () => {
        installClerkUserStub("user-1");
        const corrupted = { ...SAMPLE_DRAFT, date: "not-a-date" };
        localStorage.setItem(
          draftStorageKeyFor("user-1"),
          JSON.stringify(corrupted),
        );
        const { loadDraft } = useEntryDraft();
        const result = loadDraft();
        expect(result?.title).toBe(SAMPLE_DRAFT.title);
        expect(result?.body).toBe(SAMPLE_DRAFT.body);
      });
    });
  });

  describe("onDraftReady", () => {
    it("calls back synchronously with the draft when the session has already resolved", () => {
      installClerkUserStub("user-1");
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );
      const { onDraftReady } = useEntryDraft();
      const callback = vi.fn();

      onDraftReady(callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(SAMPLE_DRAFT);
    });

    it("calls back synchronously with null when already resolved and no draft exists", () => {
      installClerkUserStub("user-1");
      const { onDraftReady } = useEntryDraft();
      const callback = vi.fn();

      onDraftReady(callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(null);
    });

    // Regression test for the bug described in the issue: a bare loadDraft()
    // call sampled while isLoaded is still false finds no per-user key to read
    // and returns null forever, with nothing re-triggering the read once Clerk
    // hydrates. Before the fix, onDraftReady did not exist (or a naive version
    // of it would have called back once with null and never again), so this
    // fails without the reactive watch in place.
    it("does not call back while the session hasn't resolved yet", () => {
      const userRef = vue.ref<{ id: string } | null>(null);
      const isLoadedRef = vue.ref(false);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );

      const { onDraftReady } = useEntryDraft();
      const callback = vi.fn();
      onDraftReady(callback);

      expect(callback).not.toHaveBeenCalled();
    });

    it("calls back with the restored draft once the session resolves after being pending", async () => {
      const userRef = vue.ref<{ id: string } | null>(null);
      const isLoadedRef = vue.ref(false);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );

      const { onDraftReady } = useEntryDraft();
      const callback = vi.fn();
      onDraftReady(callback);
      expect(callback).not.toHaveBeenCalled();

      // Set the resolved user before flipping isLoaded, mirroring Clerk's own
      // contract (see useEntryDraft's draftStorageKey doc comment): isLoaded
      // only flips true once the user is already resolved, never the other
      // way around. Flipping isLoaded first would make the sign-out purge
      // sweep's `flush: "sync"` watcher observe a transient "resolved, no
      // user yet" tick and wipe every draft — including the one this test
      // just seeded for user-1 — before the second assignment lands.
      userRef.value = { id: "user-1" };
      isLoadedRef.value = true;
      await vue.nextTick();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(SAMPLE_DRAFT);
    });

    it("calls back only once even if isLoaded flips again after resolving", async () => {
      const userRef = vue.ref<{ id: string } | null>(null);
      const isLoadedRef = vue.ref(false);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      const { onDraftReady } = useEntryDraft();
      const callback = vi.fn();
      onDraftReady(callback);

      isLoadedRef.value = true;
      await vue.nextTick();
      expect(callback).toHaveBeenCalledTimes(1);

      isLoadedRef.value = false;
      await vue.nextTick();
      isLoadedRef.value = true;
      await vue.nextTick();

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("stops watching once the returned stop function is called", async () => {
      const userRef = vue.ref<{ id: string } | null>(null);
      const isLoadedRef = vue.ref(false);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      const { onDraftReady } = useEntryDraft();
      const callback = vi.fn();
      const stop = onDraftReady(callback);

      stop();
      isLoadedRef.value = true;
      await vue.nextTick();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("sign-out purge", () => {
    it("removes the departing user's draft when they sign out", async () => {
      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(true);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).not.toBeNull();

      userRef.value = null;
      await vue.nextTick();

      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
    });

    it("does not purge while the session hasn't resolved yet", async () => {
      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(false);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );

      useEntryDraft();
      userRef.value = null;
      await vue.nextTick();

      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).not.toBeNull();
    });

    it("purges a sign-out that lands mid-re-resolve, once the session settles", async () => {
      // A session that is being re-resolved (e.g. a token refresh racing the
      // sign-out) can surface isLoaded going false and back to true around
      // the id disappearing, rather than the id changing while isLoaded
      // stays true throughout. The purge must still fire once isLoaded
      // settles back to true, not just on the id transition itself.
      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(true);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);

      isLoadedRef.value = false;
      userRef.value = null;
      await vue.nextTick();
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).not.toBeNull();

      isLoadedRef.value = true;
      await vue.nextTick();
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
    });

    it("leaves the legacy unscoped key alone (out of scope for this sweep)", async () => {
      localStorage.setItem(
        LEGACY_DRAFT_STORAGE_KEY,
        JSON.stringify(SAMPLE_DRAFT),
      );
      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(true);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      // The legacy key was never scoped to any user, so "is this the current
      // user's own key" doesn't apply to it — it's cleaned up separately by
      // cleanupLegacyDraft (see saveDraft/loadDraft), not by this sweep.
      useEntryDraft();
      userRef.value = null;
      await vue.nextTick();

      expect(localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).not.toBeNull();
    });

    it("does not touch unrelated localStorage keys when signing out with no draft saved", async () => {
      localStorage.setItem("wanderist:theme", "dark");

      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(true);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      useEntryDraft();
      userRef.value = null;
      await vue.nextTick();

      expect(localStorage.getItem("wanderist:theme")).toBe("dark");
      expect(localStorage.length).toBe(1);
    });

    it("logs rather than throws when the sign-out purge itself fails", async () => {
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      // Spies on the localStorage instance, not Storage.prototype: happy-dom
      // shadows prototype methods with own properties on first real use, and
      // earlier tests in this file already call the real removeItem — a
      // prototype spy silently stops intercepting once that's happened.
      const removeItemSpy = vi
        .spyOn(localStorage, "removeItem")
        .mockImplementation(() => {
          throw new DOMException("denied", "SecurityError");
        });

      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(true);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      // Mounting while user-1 is current doesn't touch user-1's own key, so
      // nothing throws yet; signing out makes it stale and the sweep tries
      // (and fails) to remove it.
      useEntryDraft();
      userRef.value = null;

      await vue.nextTick();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `useEntryDraft: failed to purge draft key "${draftStorageKeyFor("user-1")}"`,
        expect.any(DOMException),
      );

      removeItemSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("purges a stale key left by a different user as soon as any session resolves", async () => {
      localStorage.setItem(
        draftStorageKeyFor("user-2"),
        JSON.stringify(SAMPLE_DRAFT),
      );
      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(true);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      // user-2's draft predates this session and isn't the active user's own
      // key, so it's purged immediately — the browser's current occupant is
      // user-1, and nothing belonging to anyone else should remain on disk,
      // not even a draft belonging to whoever uses the browser next.
      const { saveDraft } = useEntryDraft();
      expect(localStorage.getItem(draftStorageKeyFor("user-2"))).toBeNull();

      saveDraft(SAMPLE_DRAFT);
      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).not.toBeNull();
    });

    it("keeps the current user's own draft across repeated session resolves", async () => {
      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(true);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);

      // Toggling isLoaded false and back true re-runs the sweep with the
      // same id both times; the user's own key must survive both passes.
      isLoadedRef.value = false;
      await vue.nextTick();
      isLoadedRef.value = true;
      await vue.nextTick();

      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).not.toBeNull();
    });

    it("purges the outgoing user's draft, not the incoming one's, on a direct account switch", async () => {
      const userRef = vue.ref<{ id: string } | null>({ id: "user-1" });
      const isLoadedRef = vue.ref(true);
      vi.stubGlobal("useClerkUser", () => ({
        user: userRef,
        isLoaded: isLoadedRef,
      }));

      const { saveDraft } = useEntryDraft();
      saveDraft(SAMPLE_DRAFT);

      // No real Clerk flow hands off between two signed-in ids without an
      // intermediate sign-out, but the sweep covers it anyway: whichever id
      // becomes current keeps its own key, everything else goes.
      userRef.value = { id: "user-2" };
      await vue.nextTick();
      // saveDraft resolves the storage key fresh on every call (via the
      // reactive user ref), so the same handle now writes under user-2.
      saveDraft(SAMPLE_DRAFT);

      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).toBeNull();
      expect(localStorage.getItem(draftStorageKeyFor("user-2"))).not.toBeNull();
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
      installClerkUserStub("user-2");
      const { clearDraft } = useEntryDraft();

      // Seeded after the composable exists (and its mount-time sweep has
      // already run against empty storage) so this test isolates
      // clearDraft()'s own key-scoping from the sign-out sweep — the sweep
      // reacting to a *later* session change is covered separately above.
      localStorage.setItem(
        draftStorageKeyFor("user-1"),
        JSON.stringify(SAMPLE_DRAFT),
      );
      localStorage.setItem(
        draftStorageKeyFor("user-2"),
        JSON.stringify(SAMPLE_DRAFT),
      );

      clearDraft();

      expect(localStorage.getItem(draftStorageKeyFor("user-1"))).not.toBeNull();
      expect(localStorage.getItem(draftStorageKeyFor("user-2"))).toBeNull();
    });
  });
});
