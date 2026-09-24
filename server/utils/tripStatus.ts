import { TRIP_STATUS } from "../db/schema";
import type { trips } from "../db/schema";

type TripStatusFields = Pick<typeof trips.$inferSelect, "status" | "endDate">;

/**
 * Whether a trip counts toward the plan's max-active-trips limit.
 *
 * `trips.status` is only ever set by explicit client input on create/patch
 * (see server/api/trips/index.post.ts and server/api/trips/[id].patch.ts) —
 * nothing in this codebase auto-transitions it as a trip's dates lapse. A
 * trip a user forgot to flip to "past" would otherwise count against their
 * plan's active-trip limit forever (see issue #278), so this derives the
 * *effective* status from `endDate` rather than trusting the stored value
 * alone: once `endDate` is behind `now`, the trip is treated as over
 * regardless of what `status` says.
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
  if (trip.endDate !== null && trip.endDate < now) {
    return false;
  }
  return true;
}
