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
 * The composable also watches for sign-out (the user id going from set to
 * unset) and purges that user's draft from localStorage itself, rather than
 * leaving it on disk for whoever uses the browser next — see the watch()
 * call below.
 *
 * Must be called synchronously during a component's setup (it calls
 * useClerkUser(), which needs the active component instance), same as any
 * other composable that reads a Clerk composable.
 *
 * Usage:
 *   const { saveDraft, loadDraft, clearDraft } = useEntryDraft()
 */

import { isValidLocalDate } from "~/utils/localDate";

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

// Every EntryDraft field the app dereferences unconditionally after restore
// (AppNewEntry.vue reads .trim() off location, .length off tags, etc.), so a
// draft missing any of these would crash the drawer rather than degrade
// gracefully. `date` is deliberately excluded: it is validated separately by
// normalizeDraftDate below, which repairs rather than rejects, since a bad
// date alone shouldn't cost the user the rest of their draft. `placeId` and
// `uploadedPhotos` are optional/defaulted elsewhere and excluded too.
const REQUIRED_STRING_FIELDS = [
  "title",
  "body",
  "location",
  "tripId",
  "weather",
] as const;

function hasRequiredDraftFields(value: Record<string, unknown>): boolean {
  const stringFieldsPresent = REQUIRED_STRING_FIELDS.every(
    (field) => typeof value[field] === "string",
  );
  if (!stringFieldsPresent) {
    return false;
  }
  if (value.visibility !== "private" && value.visibility !== "public") {
    return false;
  }
  return Array.isArray(value.tags);
}

// Excludes arrays: `typeof [] === "object"` would otherwise pass, and
// spreading an array (`{ ...[] }`) yields `{}`, which would then fail
// hasRequiredDraftFields anyway, but rejecting it here up front keeps the
// object-shape check and the field-completeness check separately readable.
function isDraftShapedObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return hasRequiredDraftFields(value);
}

// A restored draft's `date` can be corrupt: hand-edited localStorage, a value
// written by an older/incompatible build, or a stale value from before this
// field's format changed. buildEntryPayload feeds it straight into
// localDateToIso, which silently returns undefined for anything that isn't a
// real "YYYY-MM-DD" calendar date — dropping occurredAt from the publish
// payload with no visible error and no way for the user to notice or fix it.
// Resetting to an empty string instead of guessing a date (e.g. today) keeps
// the failure visible: the date input renders blank, and AppNewEntry's publish
// guard (isValidLocalDate check before persistEntry) blocks the save with a
// message until the user picks a real date — never silently attaching the
// wrong day to the entry.
function normalizeDraftDate(date: unknown): string {
  return isValidLocalDate(date) ? date : "";
}

function keyForUser(userId: string): string {
  return `${DRAFT_STORAGE_KEY_PREFIX}:${userId}`;
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
    return keyForUser(userId);
  }

  // The last user id seen while the session was resolved (isLoaded true).
  // Tracked separately from watch()'s own previous-value argument because the
  // watch source below also needs to react to isLoaded flipping true on its
  // own (a sign-out that lands mid-resolve must still be purged once the
  // session settles), and at that point the source tuple's id half hasn't
  // changed — only isLoaded has.
  const lastSignedInUserId = ref<string | undefined>();

  // Purges the departing user's draft the instant they sign out, so it isn't
  // left on disk (readable via devtools) for the next person on a shared
  // browser. This can't be left to a future clearDraft() call: signing out
  // is a session event this component never explicitly triggers, and by the
  // time anything reacts to it, user.value has already gone null — the same
  // change this watcher is reacting to — so draftStorageKey() can no longer
  // name the departing user's key.
  //
  // Watches [isLoaded, userId] rather than just userId so a sign-out that
  // lands while the session is still resolving isn't missed: if the id goes
  // to undefined before isLoaded is true, lastSignedInUserId hasn't been set
  // yet and the callback bails out, but it fires again (and purges) once
  // isLoaded later becomes true, because that alone changes the watch
  // source even though the id itself doesn't change again.
  //
  // Also purges on a direct switch to a *different* signed-in id (not just
  // to signed-out), in case a future auth flow ever lets one session hand
  // off to another without an intermediate null — the previous id's draft is
  // purged either way, and the new id's own draft (a different storage key)
  // is untouched.
  watch(
    () => [isLoaded.value, user.value?.id] as const,
    ([loaded, currentUserId]) => {
      if (!loaded) {
        return;
      }
      const previousUserId = lastSignedInUserId.value;
      lastSignedInUserId.value = currentUserId;
      if (!previousUserId || previousUserId === currentUserId) {
        return;
      }
      purgeDraftForDepartingUser(previousUserId);
    },
    { immediate: true },
  );

  // Isolates the actual storage call so a watcher failure (e.g. localStorage
  // blocked in a third-party embed) can't propagate into Vue's error handler
  // and abort a reactive effect — the watcher above fires on session changes
  // no user gesture triggered, unlike saveDraft/clearDraft.
  function purgeDraftForDepartingUser(userId: string): void {
    try {
      localStorage.removeItem(keyForUser(userId));
      cleanupLegacyDraft();
    } catch {
      // Storage unavailable; nothing to purge in that case either.
    }
  }

  // The legacy unscoped key predates per-user scoping and could belong to any
  // account that used this browser. We can't safely attribute it to whichever
  // user happens to load next, so rather than migrating it into that user's
  // draft, we drop it — reasonable cleanup that stops it from ever leaking
  // into an account it wasn't written for. Safe to call even when the key was
  // never set. saveDraft/loadDraft only call this once we have a resolved,
  // signed-in key, so those call sites never fire it (and destroy a legacy
  // draft pointlessly) while the session is still loading or signed out and
  // there is no user to hand the cleanup to. purgeDraftForDepartingUser is
  // the one exception: it calls this right as a real signed-in session ends,
  // which is exactly the moment a leftover legacy draft is also readable by
  // whoever uses the browser next, so it is deliberately purged there too.
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
      const parsed: unknown = JSON.parse(raw);
      if (!isDraftShapedObject(parsed)) {
        localStorage.removeItem(key);
        return null;
      }
      return {
        ...(parsed as EntryDraft),
        date: normalizeDraftDate(parsed.date),
      };
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
