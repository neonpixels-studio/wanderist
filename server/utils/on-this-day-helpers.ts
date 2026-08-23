import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDb } from "../db/index";
import { entries } from "../db/schema";
import { loadRelationsForEntries } from "./entry-helpers";
import type { EntryRelations } from "./entry-helpers";

export type OnThisDayEntry = typeof entries.$inferSelect & EntryRelations;

/**
 * The month/day/year "on this day" is keyed off. These come from the viewer's
 * own local calendar date (passed by the client), not the server clock, so a
 * user far from UTC sees their real calendar day rather than the server's.
 */
export interface OnThisDayDate {
  month: number;
  day: number;
  year: number;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_OFFSET = 1;
// Sanity bounds on the client-supplied year, so a bogus value like 9999 can't
// widen the "prior years" match to every entry. The floor is the Unix epoch;
// the ceiling tolerates a viewer whose local date has rolled into next year
// slightly ahead of the server clock.
const MIN_REFERENCE_YEAR = 1970;
const MAX_YEAR_SKEW = 1;

function isRealCalendarDate({ month, day, year }: OnThisDayDate): boolean {
  // Reject impossible combinations (wrong month/day ranges and non-existent
  // days like 2026-02-30) via a UTC round-trip: Date.UTC rolls overflowing
  // parts into a different month/day/year, so any mismatch means invalid. UTC
  // keeps the check independent of the server's local timezone.
  const asUtc = new Date(Date.UTC(year, month - MONTH_OFFSET, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() + MONTH_OFFSET === month &&
    asUtc.getUTCDate() === day
  );
}

function isReasonableYear(year: number): boolean {
  const maxYear = new Date().getUTCFullYear() + MAX_YEAR_SKEW;
  return year >= MIN_REFERENCE_YEAR && year <= maxYear;
}

/**
 * Parses a client-provided local date string in `YYYY-MM-DD` form into its
 * month/day/year parts. Returns null for anything malformed, not a real
 * calendar date, or carrying an implausible year, so callers can fall back to
 * the server clock.
 */
export function parseLocalDateParam(value: unknown): OnThisDayDate | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = LOCAL_DATE_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const parsed = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };

  if (!isReasonableYear(parsed.year)) {
    return null;
  }
  if (!isRealCalendarDate(parsed)) {
    return null;
  }

  return parsed;
}

/**
 * Resolves the reference date "on this day" keys off. Prefers the viewer's
 * local date (from the client) and falls back to the server clock's UTC date
 * when the client sends nothing usable, preserving the old behaviour for
 * callers that don't supply a local date.
 */
export function resolveReferenceDate(value: unknown): OnThisDayDate {
  const localDate = parseLocalDateParam(value);
  if (localDate) {
    return localDate;
  }

  const now = new Date();
  return {
    month: now.getUTCMonth() + MONTH_OFFSET,
    day: now.getUTCDate(),
    year: now.getUTCFullYear(),
  };
}

/**
 * Builds a SQL condition that matches rows whose `occurred_at` falls on the
 * same month/day as `referenceDate` but in a strictly earlier year.
 *
 * `referenceDate` carries the viewer's local month/day/year (see
 * `resolveReferenceDate`), which fixes the reported bug: the reference day now
 * follows the viewer's calendar rather than the server's UTC day.
 *
 * The `occurred_at` side is still extracted in UTC. `occurred_at` is stored as
 * the UTC instant of the entry's local midnight at creation time, so an entry
 * whose creation timezone differs from UTC can extract to the neighbouring UTC
 * day and match a day off. Fully aligning both sides needs the entry's own
 * timezone (or a date-only column) and is tracked as a follow-up.
 */
export function buildOnThisDayFilter(
  userId: string,
  referenceDate: OnThisDayDate,
): SQL[] {
  return [
    eq(entries.userId, userId),
    isNotNull(entries.occurredAt),
    sql`EXTRACT(MONTH FROM ${entries.occurredAt}) = ${referenceDate.month}`,
    sql`EXTRACT(DAY FROM ${entries.occurredAt}) = ${referenceDate.day}`,
    sql`EXTRACT(YEAR FROM ${entries.occurredAt}) < ${referenceDate.year}`,
  ];
}

/**
 * Fetches journal entries that occurred on the same month/day as
 * `referenceDate` but in prior years, scoped to `userId`.
 *
 * Returns entries enriched with photos and tags, ordered by `occurred_at` desc
 * so the most-recent matching year appears first. Relations are fetched via
 * `loadRelationsForEntries`, which issues two batched queries (one for
 * photos, one for tags) regardless of how many entries match, instead of two
 * queries per matching entry.
 */
export async function fetchOnThisDayEntries(
  userId: string,
  referenceDate: OnThisDayDate,
): Promise<OnThisDayEntry[]> {
  const database = getDb();
  const filters = buildOnThisDayFilter(userId, referenceDate);

  const rows = await database
    .select()
    .from(entries)
    .where(and(...filters))
    .orderBy(sql`${entries.occurredAt} DESC`);

  if (rows.length === 0) {
    return [];
  }

  const entryIds = rows.map((row) => row.id);
  const relationsByEntryId = await loadRelationsForEntries(database, entryIds);

  return rows.map((row) => {
    const relations = relationsByEntryId.get(row.id);
    if (!relations) {
      throw new Error(
        `loadRelationsForEntries did not return relations for entry ${row.id}`,
      );
    }
    return { ...row, ...relations };
  });
}
