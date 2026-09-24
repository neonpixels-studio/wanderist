import { TRIP_STATUS } from "../db/schema";
import type { trips } from "../db/schema";

type TripStatusFields = {
  status: (typeof trips.$inferSelect)["status"];
  // `undefined` as well as `null`: defensively tolerated because not every
  // caller is a full DB row — e.g. a partially-built test fixture, or a
  // future caller assembling this shape by hand, may omit `endDate` rather
  // than setting it explicitly to `null`.
  endDate: (typeof trips.$inferSelect)["endDate"] | undefined;
};

/**
 * Whether a trip counts toward the plan's max-active-trips limit.
 *
 * `trips.status` is only ever set by explicit client input on create/patch
 * (see server/api/trips/index.post.ts and server/api/trips/[id].patch.ts) —
 * nothing in this codebase auto-transitions it as a trip's dates lapse. A
 * trip a user forgot to flip to "past" would otherwise count against their
 * plan's active-trip limit forever (see issue #278), so this derives the
 * *effective* status from `endDate` rather than trusting the stored value
 * alone: once the UTC calendar day after `endDate` has begun, the trip is
 * treated as over regardless of what `status` says.
 *
 * Comparing calendar days (rather than `endDate` plus a fixed 24h) matters
 * because `endDate` isn't guaranteed to be UTC midnight — `parseOptionalDate`
 * accepts any parseable date string, and the column is a full `timestamp`,
 * not a date-only type. A raw instant-vs-instant comparison, or a naive
 * "+24h", would cut a traveler's final day short (or long) depending on what
 * time of day the value happened to carry. Truncating both sides to a UTC
 * calendar day keeps the trip active through the entirety of its `endDate`
 * day no matter what time component it was stored with.
 *
 * An explicit "past" status always wins, even with no `endDate` to derive
 * from (e.g. a trip cancelled before it started) — derivation can only push
 * a trip toward "not active", it never pulls one back into counting.
 */
export function isTripCountedAsActive(
  trip: TripStatusFields,
  now: Date = new Date(),
): boolean {
  if (trip.status === TRIP_STATUS.PAST) {
    return false;
  }
  if (trip.endDate === null || trip.endDate === undefined) {
    return true;
  }
  const startOfDayAfterEndDate = Date.UTC(
    trip.endDate.getUTCFullYear(),
    trip.endDate.getUTCMonth(),
    trip.endDate.getUTCDate() + 1,
  );
  return startOfDayAfterEndDate > now.getTime();
}
