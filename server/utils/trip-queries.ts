/**
 * Read/visibility queries for trips.
 *
 * Accepts a pre-built database instance so it can be tested in isolation
 * without mocking module-level singletons, matching guide-queries and
 * discover-queries.
 */
import { eq } from "drizzle-orm";
import { trips, VISIBILITY } from "../db/schema";
import type { Database } from "./discover-queries";

type Trip = typeof trips.$inferSelect;

// One message for both 404 branches (missing trip / not allowed to read it) so
// a non-owner can't tell a private trip apart from one that doesn't exist, and
// the two throws can't drift.
const TRIP_NOT_FOUND = "Trip not found";

async function fetchTripRow(
  database: Database,
  id: string,
): Promise<Trip | undefined> {
  const rows = await database
    .select()
    .from(trips)
    .where(eq(trips.id, id))
    .limit(1);

  return rows[0];
}

/**
 * Loads a single trip by id and enforces read visibility: the owner reads their
 * trip at any visibility; a non-owner reads it only when it is public. Anything
 * else throws 404 (not 403) so the endpoint never leaks that a trip with that
 * id exists — mirroring how loadOwnedOrThrow hides other users' rows.
 *
 * `userId` is null for an anonymous visitor following a shared public-trip link.
 * An anonymous reader is simply a non-owner (a null id never equals a trip's
 * owner), so they see only public trips and nothing a signed-in non-owner
 * couldn't.
 *
 * Unlike guides (guide-queries.loadReadableGuide), which additionally require a
 * discoverable author because a non-owner only ever obtains a guide id via
 * explore, a trip is shared by an explicit owner action ("make public" then
 * copy link). Gating that deliberate share behind explore opt-in would break
 * the link for an owner who is not on explore, so the read is gated purely on
 * `visibility = public`.
 */
export async function loadReadableTrip(
  database: Database,
  id: string,
  userId: string | null,
): Promise<Trip> {
  const trip = await fetchTripRow(database, id);

  if (!trip) {
    throw createError({ statusCode: 404, statusMessage: TRIP_NOT_FOUND });
  }

  if (trip.userId === userId) {
    return trip;
  }

  if (trip.visibility !== VISIBILITY.PUBLIC) {
    throw createError({ statusCode: 404, statusMessage: TRIP_NOT_FOUND });
  }

  return trip;
}
