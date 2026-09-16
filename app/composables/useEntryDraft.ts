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
 * The composable also watches the resolved session and sweeps localStorage
 * so the only draft key ever left on disk is the current user's own — see
 * the watch() call below. This is deliberately more aggressive than "purge
 * on sign-out": Wanderist has no in-app sign-out control today, so the
 * common way a session actually ends is the tab closing or the token
 * expiring while the app isn't open, not a live transition this composable
 * could watch. Sweeping on every resolved render (including the first one
 * after a fresh sign-in) also catches a *different* user's leftover key from
 * an earlier session on the same shared browser, not only the composable's
 * own most-recently-seen user.
 *
 * Must be called synchronously during a component's setup (it calls
 * useClerkUser(), which needs the active component instance), same as any
 * other composable that reads a Clerk composable.
 *
 * Usage:
 *   const { saveDraft, loadDraft, clearDraft, onDraftReady } = useEntryDraft()
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

// Deliberately excludes the legacy unscoped key: unlike a per-user key, it
// can't be attributed to "belongs to the current user or is stale" — it
// predates per-user scoping entirely, so it's not this sweep's concern. It
// keeps its own narrower, already-reasoned handling in cleanupLegacyDraft
// below (only touched once there's a resolved, signed-in user to hand the
// cleanup to).
function isDraftKey(key: string): boolean {
  return key.startsWith(`${DRAFT_STORAGE_KEY_PREFIX}:`);
}

// Isolates each storage deletion so one failing key (e.g. localStorage
// blocked in a third-party embed) can't skip a sibling deletion or propagate
// into Vue's error handler and abort a reactive effect — the sweep below
// fires on session changes no user gesture triggered, unlike
// saveDraft/loadDraft/clearDraft. Logs rather than swallowing silently: a
// failed privacy-motivated deletion should be observable, not just assumed
// to have happened.
function removeKeySafely(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`useEntryDraft: failed to purge draft key "${key}"`, error);
  }
}

// Removes every draft key in localStorage except the current user's own
// (or every draft key at all, if nobody is currently signed in). Any other
// key is, by definition, left over from a session that is no longer active —
// whether that's the same browser's previous occupant signing out, or this
// user finding a stranger's key still here from before they signed in.
function purgeStaleDrafts(currentUserId: string | undefined): void {
  const currentUserKey = currentUserId ? keyForUser(currentUserId) : null;
  Object.keys(localStorage)
    .filter((key) => isDraftKey(key) && key !== currentUserKey)
    .forEach(removeKeySafely);
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

  // Sweeps localStorage every time the session resolves to a new state, so
  // the only draft key ever left on disk is the current user's own (see
  // purgeStaleDrafts above for why this is a full sweep rather than tracking
  // just the one id this composable previously saw). This can't be left to a
  // future clearDraft() call keyed off draftStorageKey(): that function only
  // knows the *current* signed-in user, so it can never name a departing or
  // stranger's leftover key for removal.
  //
  // `flush: "sync"` runs the sweep synchronously, in the same tick as the
  // reactive change, rather than batched onto a microtask: if a future
  // sign-out flow ever triggers a full-page redirect (e.g. Clerk's
  // signOut({ redirectUrl })), that navigation must not be able to happen
  // before this purge runs. The callback is cheap (a localStorage scan plus
  // a few removeItem calls), so there's no batching benefit to give up.
  watch(
    () => [isLoaded.value, user.value?.id] as const,
    ([loaded, currentUserId]) => {
      if (!loaded) {
        return;
      }
      purgeStaleDrafts(currentUserId);
    },
    { immediate: true, flush: "sync" },
  );

  // The legacy unscoped key predates per-user scoping and could belong to any
  // account that used this browser. We can't safely attribute it to whichever
  // user happens to load next, so rather than migrating it into that user's
  // draft, we drop it — reasonable cleanup that stops it from ever leaking
  // into an account it wasn't written for. Safe to call even when the key was
  // never set. Only called once we have a resolved, signed-in key so it never
  // fires (and destroys a legacy draft pointlessly) while the session is
  // still loading or signed out and there is no user to hand the cleanup to.
  // Deliberately not part of the watch() sweep above: that sweep decides
  // what's stale by comparing against the *current* user's own key, which
  // doesn't apply to a key that was never scoped to any user in the first
  // place — it keeps this narrower, already-reasoned handling instead.
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

  // loadDraft() and draftStorageKey() intentionally sample isLoaded/user the
  // instant they're called: calling loadDraft() while isLoaded is still false
  // finds no per-user key to read yet and returns null, and nothing about
  // that call re-runs later on its own. A caller that reads loadDraft()
  // before Clerk has hydrated (e.g. a drawer that can open pre-hydration)
  // gets that one-shot null forever, even though a real draft may exist once
  // the session resolves.
  //
  // onDraftReady bridges that gap: if the session has already resolved,
  // it invokes `callback` synchronously with the current draft (identical to
  // calling loadDraft() directly). Otherwise it watches isLoaded until it
  // flips true, then invokes `callback` once with the draft for whichever
  // user is now signed in (or null if the session resolves signed-out).
  //
  // isLoaded is the sole readiness gate here, matching draftStorageKey()'s own
  // contract (it too only ever consults user.value after isLoaded.value is
  // true): Clerk resolves isLoaded and user together, so "isLoaded true, no
  // user" already means "resolved, signed out" everywhere else in this file,
  // not "still hydrating the user".
  //
  // Returns a stop function. Callers should call it once they no longer care
  // about the pending result — e.g. the consuming UI closed or moved on to a
  // different mode — so a session that resolves later can't invoke a stale
  // callback.
  function onDraftReady(
    callback: (draft: EntryDraft | null) => void,
  ): () => void {
    if (isLoaded.value) {
      callback(loadDraft());
      return () => {};
    }

    const stopWatching = watch(isLoaded, (loaded) => {
      if (!loaded) {
        return;
      }
      stopWatching();
      callback(loadDraft());
    });

    return stopWatching;
  }

  return { saveDraft, loadDraft, clearDraft, onDraftReady };
}
