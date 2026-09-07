/**
 * Composable for persisting and restoring a new-entry form draft via localStorage.
 *
 * Storing the draft here rather than inline in the component keeps the browser
 * storage call testable in isolation (find/replace the composable in tests).
 *
 * Usage:
 *   const { saveDraft, loadDraft, clearDraft } = useEntryDraft()
 */

import { isValidLocalDate, localIsoDate } from "~/utils/localDate";

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

// A restored draft's `date` can be corrupt: hand-edited localStorage, a value
// written by an older/incompatible build, or a stale value from before this
// field's format changed. buildEntryPayload feeds it straight into
// localDateToIso, which silently returns undefined for anything that isn't a
// real "YYYY-MM-DD" calendar date — dropping occurredAt from the publish
// payload with no visible error. Normalize here so a bad value never survives
// the restore. This only validates `date`; other malformed fields (e.g. a
// draft missing `tags`) are a separate, broader shape-validation problem this
// change doesn't attempt to solve.
function normalizeDraftDate(date: unknown): string {
  if (isValidLocalDate(date)) {
    return date;
  }
  return localIsoDate();
}

// Excludes arrays: `typeof [] === "object"` would otherwise pass, and
// spreading an array (`{ ...[] }`) yields `{}`, silently producing a draft
// with every field but `date` set to `undefined`.
function isDraftShapedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
