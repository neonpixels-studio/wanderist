/**
 * Shared helpers for trip and stop route handlers.
 *
 * Centralises the repetitive id-validation + ownership-check pattern that
 * appears across every trip/stop handler, and the stop-lookup guard that
 * verifies a stop belongs to the authenticated user's trip before mutating it.
 */
import type { H3Event } from "h3";
import { eq, and } from "drizzle-orm";
import { trips, tripStops } from "../db/schema";
import { loadOwnedOrThrow } from "./db-helpers";
import { getDb } from "../db/index";

type Trip = typeof trips.$inferSelect;
type TripStop = typeof tripStops.$inferSelect;
type Database = ReturnType<typeof getDb>;

/**
 * Reads and validates the `id` router param as a trip id. Throws 400 when
 * missing. Does not check ownership — call `loadOwnedTrip` for that.
 */
export function requireTripId(event: H3Event): string {
  const tripId = getRouterParam(event, "id");

  if (!tripId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Trip id is required",
    });
  }

  return tripId;
}

/**
 * Reads and validates the `stopId` router param. Throws 400 when missing.
 */
export function requireStopId(event: H3Event): string {
  const stopId = getRouterParam(event, "stopId");

  if (!stopId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Stop id is required",
    });
  }

  return stopId;
}

/**
 * Validates the trip id and verifies the authenticated user owns the trip.
 * Throws 400 if the id is missing, 401 if not authenticated, 404 if not found
 * or not owned.
 */
export async function loadOwnedTrip(
  event: H3Event,
  tripId: string,
): Promise<Trip> {
  return loadOwnedOrThrow<Trip>(event, trips, trips.id, trips.userId, tripId);
}

/**
 * Throws 404 when the caller does not own `tripId`. Undefined is a no-op; any
 * supplied id (including "") is looked up, so it can never bypass the check.
 */
export async function assertTripOwnershipIfPresent(
  event: H3Event,
  tripId: string | undefined,
): Promise<void> {
  if (tripId === undefined) {
    return;
  }

  await loadOwnedTrip(event, tripId);
}

/**
 * Looks up a stop by id and verifies it belongs to the given trip. Throws 404
 * if the stop does not exist or does not belong to this trip.
 */
export async function loadTripStop(
  database: Database,
  tripId: string,
  stopId: string,
): Promise<TripStop> {
  const rows = await database
    .select()
    .from(tripStops)
    .where(and(eq(tripStops.id, stopId), eq(tripStops.tripId, tripId)))
    .limit(1);

  if (!rows[0]) {
    throw createError({ statusCode: 404, statusMessage: "Stop not found" });
  }

  return rows[0] as TripStop;
}
