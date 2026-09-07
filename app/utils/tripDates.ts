/**
 * Formats a trip's start/end dates as the date-range label shown on a trip
 * card ("Jun 1, 2024 – Jun 14, 2024 · 13 days"). Shared by the trips list
 * (trips/index.vue) and the profile page's public trips section
 * (ProfileTripList.vue) so the same trip reads identically wherever a card
 * shows it — two independent copies of this format previously existed and
 * had already drifted (one omitted the day count).
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

export function formatTripDateRange(
  startDate: string | Date | null,
  endDate: string | Date | null,
): string {
  if (!startDate) {
    return "dates TBD";
  }

  const start = new Date(startDate);
  const startLabel = start.toLocaleDateString("en-US", UTC_DATE_FORMAT);

  if (!endDate) {
    return startLabel;
  }

  const end = new Date(endDate);
  const endLabel = end.toLocaleDateString("en-US", UTC_DATE_FORMAT);
  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);

  return `${startLabel} – ${endLabel} · ${days} days`;
}
