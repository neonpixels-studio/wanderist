/**
 * Composable for persisting and restoring a new-entry form draft via localStorage.
 *
 * Storing the draft here rather than inline in the component keeps the browser
 * storage call testable in isolation (find/replace the composable in tests).
 *
 * The storage key is scoped to the signed-in user's id so a saved draft
 * (including placeId) never leaks to a different account on a shared browser:
 * two users signed into the same browser get isolated drafts, and a
 * logged-out/not-yet-loaded state gets its own key rather than falling
 * through to whichever draft happens to be on disk.
 *
 * Usage:
 *   const { saveDraft, loadDraft, clearDraft } = useEntryDraft()
 */

const DRAFT_STORAGE_KEY_PREFIX = "wanderist:new-entry-draft";
// Key used before drafts were scoped per user. No draft is written under it
// anymore, but a browser that used an older build may still have one on disk.
const LEGACY_DRAFT_STORAGE_KEY = DRAFT_STORAGE_KEY_PREFIX;
const ANONYMOUS_DRAFT_SEGMENT = "anonymous";

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
  const { user } = useClerkUser();

  // Read the id fresh on every call (via the reactive ref) rather than once
  // at setup, so a session that resolves/changes after this composable is
  // created is still reflected in the key used.
  function draftStorageKey(): string {
    const userId = user.value?.id;
    return `${DRAFT_STORAGE_KEY_PREFIX}:${userId ?? ANONYMOUS_DRAFT_SEGMENT}`;
  }

  // The legacy unscoped key predates per-user scoping and could belong to any
  // account that used this browser. We can't safely attribute it to whichever
  // user happens to load next, so rather than migrating it into that user's
  // draft, we drop it once here — reasonable cleanup that stops it from ever
  // leaking into an account it wasn't written for. Safe to call even when the
  // key was never set.
  function cleanupLegacyDraft(): void {
    localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
  }

  function saveDraft(draft: EntryDraft): void {
    cleanupLegacyDraft();
    localStorage.setItem(draftStorageKey(), JSON.stringify(draft));
  }

  function loadDraft(): EntryDraft | null {
    cleanupLegacyDraft();
    const raw = localStorage.getItem(draftStorageKey());
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as EntryDraft;
    } catch {
      // Corrupt storage; discard silently so the user gets a clean form
      localStorage.removeItem(draftStorageKey());
      return null;
    }
  }

  function clearDraft(): void {
    localStorage.removeItem(draftStorageKey());
  }

  return { saveDraft, loadDraft, clearDraft };
}
