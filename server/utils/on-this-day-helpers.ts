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
const FIRST_MONTH = 1;
const LAST_MONTH = 12;
const FIRST_DAY = 1;
const LAST_DAY = 31;
const MONTH_OFFSET = 1;

function isRealCalendarDate({ month, day, year }: OnThisDayDate): boolean {
  // Reject impossible combinations like 2026-02-30. Build the date in UTC so
  // the round-trip check never depends on the server's local timezone.
  const asUtc = new Date(Date.UTC(year, month - MONTH_OFFSET, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() + MONTH_OFFSET === month &&
    asUtc.getUTCDate() === day
  );
}

/**
 * Parses a client-provided local date string in `YYYY-MM-DD` form into its
 * month/day/year parts. Returns null for anything malformed or not a real
 * calendar date, so callers can fall back to the server clock.
 */
export function parseLocalDateParam(value: unknown): OnThisDayDate | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = LOCAL_DATE_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < FIRST_MONTH || month > LAST_MONTH) {
    return null;
  }
  if (day < FIRST_DAY || day > LAST_DAY) {
    return null;
  }

  const parsed = { month, day, year };
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
 * `resolveReferenceDate`). The DB extract stays UTC (timestamps are stored as
 * UTC), so only the reference side reflects the viewer's timezone.
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
