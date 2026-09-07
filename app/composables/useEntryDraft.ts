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
      const parsed = JSON.parse(raw) as EntryDraft;
      if (!parsed || typeof parsed !== "object") {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        return null;
      }
      return { ...parsed, date: normalizeDraftDate(parsed.date) };
    } catch {
      // Corrupt storage; discard silently so the user gets a clean form
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
  }

  // A restored draft's date can be corrupt: hand-edited localStorage, a value
  // written by an older/incompatible build, or a partial write. buildEntryPayload
  // feeds this straight into localDateToIso, which silently returns undefined
  // for anything that isn't a real "YYYY-MM-DD" calendar date — dropping
  // occurredAt from the publish payload with no visible error. Normalize here so
  // a bad value never survives the restore.
  function normalizeDraftDate(date: unknown): string {
    if (isValidLocalDate(date)) {
      return date;
    }
    return localIsoDate();
  }

  function clearDraft(): void {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  }

  return { saveDraft, loadDraft, clearDraft };
}
