/**
 * Composable for persisting and restoring a new-entry form draft via localStorage.
 *
 * Storing the draft here rather than inline in the component keeps the browser
 * storage call testable in isolation (find/replace the composable in tests).
 *
 * Usage:
 *   const { saveDraft, loadDraft, clearDraft } = useEntryDraft()
 */

import { isValidLocalDate } from "~/utils/localDate";

const DRAFT_STORAGE_KEY = "wanderist:new-entry-draft";

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

export function useEntryDraft() {
  function saveDraft(draft: EntryDraft): void {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }

  function loadDraft(): EntryDraft | null {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isDraftShapedObject(parsed)) {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        return null;
      }
      return {
        ...(parsed as EntryDraft),
        date: normalizeDraftDate(parsed.date),
      };
    } catch {
      // Corrupt storage; discard silently so the user gets a clean form
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
  }

  function clearDraft(): void {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  }

  return { saveDraft, loadDraft, clearDraft };
}
