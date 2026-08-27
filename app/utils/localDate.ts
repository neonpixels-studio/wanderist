const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert a calendar date string ("YYYY-MM-DD", e.g. from an <input type="date">)
 * into an ISO timestamp that preserves the calendar date the user picked,
 * independent of the picker's timezone.
 *
 * The naive `new Date(year, month - 1, day).toISOString()` builds *local* midnight
 * and then converts to UTC, so for a positive (east-of-UTC) offset that midnight
 * rolls back to the previous UTC day — persisting the wrong calendar date. Anchor
 * the date at UTC midnight instead (by parsing an explicit `…T00:00:00.000Z`
 * instant), so the UTC calendar components always match the components the user
 * chose. Entry display reads UTC components (JournalEntry.vue uses
 * `timeZone: "UTC"`, journal.vue uses `getUTCFullYear`), so this keeps write and
 * read on the same calendar date.
 *
 * Forward-only: rows written before this fix hold *local* midnight and still
 * render/group by their old UTC offset. There is no safe automatic backfill —
 * the intended calendar date of a historical row depends on the author's
 * original timezone, which was never stored.
 *
 * Malformed input (a hand-edited or stale localStorage draft can feed this a
 * non-"YYYY-MM-DD" value via useEntryDraft) returns undefined rather than
 * throwing a RangeError. A day that overflows its month (e.g. "2026-02-31")
 * rolls over in the parser; the round-trip check rejects it so an impossible
 * date is never silently saved on a different day. Parsing an explicit UTC
 * instant also keeps years below 1000 verbatim, unlike Date.UTC which maps
 * year 0-99 to 1900+year.
 */
export function localDateToIso(dateString: string): string | undefined {
  if (!LOCAL_DATE_PATTERN.test(dateString)) {
    return undefined;
  }
  const timestamp = Date.parse(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  const iso = new Date(timestamp).toISOString();
  if (!iso.startsWith(dateString)) {
    return undefined;
  }
  return iso;
}
