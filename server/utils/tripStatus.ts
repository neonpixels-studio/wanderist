import { TRIP_STATUS } from "../db/schema";
import type { trips } from "../db/schema";

type TripStatusFields = {
  status: (typeof trips.$inferSelect)["status"];
  // `undefined` as well as `null`: some call sites build this from an
  // existing trip object where `endDate` may be omitted rather than
  // explicitly set to `null`.
  endDate: (typeof trips.$inferSelect)["endDate"] | undefined;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a trip counts toward the plan's max-active-trips limit.
 *
 * `trips.status` is only ever set by explicit client input on create/patch
 * (see server/api/trips/index.post.ts and server/api/trips/[id].patch.ts) —
 * nothing in this codebase auto-transitions it as a trip's dates lapse. A
 * trip a user forgot to flip to "past" would otherwise count against their
 * plan's active-trip limit forever (see issue #278), so this derives the
 * *effective* status from `endDate` rather than trusting the stored value
 * alone: once a full day has passed since `endDate`, the trip is treated as
 * over regardless of what `status` says.
 *
 * The one-day grace period matters because `endDate` is stored as a
 * date-only value at UTC midnight (see parseOptionalDate): comparing
 * directly against `now` would mark a trip "over" the instant its last day
 * begins, cutting a traveler's final day out from under them. Requiring a
 * full day to elapse keeps the trip active through the entirety of its
 * `endDate` calendar day.
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
  const endOfTripDay = trip.endDate.getTime() + ONE_DAY_MS;
  return endOfTripDay > now.getTime();
}
