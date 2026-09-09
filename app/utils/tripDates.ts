/**
 * Formats a trip's start/end dates as the date-range label shown on a trip
 * card ("Jun 1, 2024 – Jun 14, 2024 · 13 days"). Shared by the trips list
 * (trips/index.vue) and the profile page's public trips section
 * (ProfileTripList.vue) so the same trip reads identically wherever a card
 * shows it — two independent copies of this format previously existed and
 * had already drifted (one omitted the day count).
 *
 * The day count is the exclusive difference between the two dates (end -
 * start), matching the original trips/index.vue convention: Jun 1 – Jun 14
 * reports "13 days", not 14 — it's a duration, not an inclusive count of
 * calendar days touched.
 *
 * Distinct from trips/[id].vue's `formatHeroDates`, which intentionally omits
 * the year for its hero header — a different display context, not a copy of
 * this one.
 */

// Mirrors the trips.status enum (server/db/schema.ts tripStatusEnum).
export type TripStatus = "ongoing" | "upcoming" | "past";

const UTC_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function formatDayCount(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

export function formatTripDateRange(
  startDate: string | Date | null,
  endDate: string | Date | null,
): string {
  if (!startDate) {
    return "dates TBD";
  }

  const start = new Date(startDate);
  // A malformed date string (this util's contract now spans looser-typed
  // callers, e.g. app/stores/trips.ts's plain `string | null`) must not
  // render "Invalid Date" to the user — fall back to the same "unknown"
  // state as a missing date.
  if (!isValidDate(start)) {
    return "dates TBD";
  }
  const startLabel = start.toLocaleDateString("en-US", UTC_DATE_FORMAT);

  if (!endDate) {
    return startLabel;
  }

  const end = new Date(endDate);
  if (!isValidDate(end)) {
    return startLabel;
  }
  const endLabel = end.toLocaleDateString("en-US", UTC_DATE_FORMAT);
  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);

  // A same-day trip (a valid, API-accepted range) has an exclusive day
  // difference of 0 — render it as a single date rather than "· 0 days".
  if (days <= 0) {
    return startLabel;
  }

  return `${startLabel} – ${endLabel} · ${formatDayCount(days)}`;
}
