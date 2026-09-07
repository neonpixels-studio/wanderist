/**
 * Composable for persisting and restoring a new-entry form draft via localStorage.
 *
 * Storing the draft here rather than inline in the component keeps the browser
 * storage call testable in isolation (find/replace the composable in tests).
 *
 * The storage key is scoped to the signed-in user's id so a saved draft
 * (including placeId) never leaks to a different account on a shared browser.
 * There's no legitimate anonymous draft (the new-entry form only renders
 * behind the auth-gated layout), so an unresolved-or-signed-out session makes
 * every operation a no-op rather than fall back to a key shared across
 * sessions — see draftStorageKey below.
 *
 * Must be called synchronously during a component's setup (it calls
 * useClerkUser(), which needs the active component instance), same as any
 * other composable that reads a Clerk composable.
 *
 * Usage:
 *   const { saveDraft, loadDraft, clearDraft } = useEntryDraft()
 */

const DRAFT_STORAGE_KEY_PREFIX = "wanderist:new-entry-draft";
// Fixed literal (not derived from the prefix above): this is the exact key
// used before drafts were scoped per user. No draft is written under it
// anymore, but a browser that used an older build may still have one on disk.
// Kept independent of DRAFT_STORAGE_KEY_PREFIX so a future rename of the
// current prefix can't silently stop this cleanup from matching the old key.
const LEGACY_DRAFT_STORAGE_KEY = "wanderist:new-entry-draft";

export interface EntryDraft {
  title: string;
  body: string;
  location: string;
  // Id of the saved place the location resolves to; empty for free text with
  // no matching place. Optional so drafts written before this field existed
  // still parse.
  placeId?: string;
  tripId: string;
  date: string;
  visibility: "private" | "public";
  tags: string[];
  weather: string;
  uploadedPhotos: Array<{ id: string; url: string }>;
}

export function useEntryDraft() {
  const { user, isLoaded } = useClerkUser();

  // Read fresh on every call (via the reactive refs) rather than once at
  // setup, so a session that resolves/changes after this composable was
  // created is still reflected in the key used.
  function draftStorageKey(): string | null {
    if (!isLoaded.value) {
      return null;
    }
    const userId = user.value?.id;
    if (!userId) {
      return null;
    }
    return `${DRAFT_STORAGE_KEY_PREFIX}:${userId}`;
  }

  // The legacy unscoped key predates per-user scoping and could belong to any
  // account that used this browser. We can't safely attribute it to whichever
  // user happens to load next, so rather than migrating it into that user's
  // draft, we drop it — reasonable cleanup that stops it from ever leaking
  // into an account it wasn't written for. Safe to call even when the key was
  // never set. Only called once we have a resolved, signed-in key so it never
  // fires (and destroys a legacy draft pointlessly) while the session is
  // still loading or signed out and there is no user to hand the cleanup to.
  function cleanupLegacyDraft(): void {
    localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
  }

  function saveDraft(draft: EntryDraft): void {
    const key = draftStorageKey();
    if (!key) {
      return;
    }
    cleanupLegacyDraft();
    localStorage.setItem(key, JSON.stringify(draft));
  }

  function loadDraft(): EntryDraft | null {
    const key = draftStorageKey();
    if (!key) {
      return null;
    }
    cleanupLegacyDraft();
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as EntryDraft;
    } catch {
      // Corrupt storage; discard silently so the user gets a clean form
      localStorage.removeItem(key);
      return null;
    }
  }

  function clearDraft(): void {
    const key = draftStorageKey();
    if (!key) {
      return;
    }
    localStorage.removeItem(key);
  }

  return { saveDraft, loadDraft, clearDraft };
}
