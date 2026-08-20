import { eq, max } from "drizzle-orm";
import { getDb } from "../../../../db/index";
import { trips, tripStops, TRIP_STOP_STATUS } from "../../../../db/schema";
import { requireString, optionalString } from "../../../../utils/db-helpers";
import { assertPlaceOwnedIfPresent } from "../../../../utils/place-helpers";
import {
  parseEnum,
  parseOptionalDate,
  parseOptionalInt,
  parseOptionalFloat,
  toNullable,
} from "../../../../utils/validation";
import { requireTripId, loadOwnedTrip } from "../../../../utils/trip-helpers";

type Trip = typeof trips.$inferSelect;
type TripStop = typeof tripStops.$inferSelect;
type NewStop = typeof tripStops.$inferInsert;
type Database = ReturnType<typeof getDb>;

const VALID_STOP_STATUSES = [
  TRIP_STOP_STATUS.DONE,
  TRIP_STOP_STATUS.NEXT,
  TRIP_STOP_STATUS.PLANNED,
] as const;

async function getNextSortOrder(
  database: Database,
  tripId: string,
): Promise<number> {
  const rows = await database
    .select({ maxOrder: max(tripStops.sortOrder) })
    .from(tripStops)
    .where(eq(tripStops.tripId, tripId));

  const currentMax = rows[0]?.maxOrder;
  return currentMax !== null && currentMax !== undefined ? currentMax + 1 : 0;
}

function parseStopBody(body: Record<string, unknown>) {
  requireString(body?.name, "name");

  return {
    name: body.name as string,
    status: parseEnum(
      body.status,
      VALID_STOP_STATUSES,
      "status",
      TRIP_STOP_STATUS.PLANNED,
    ),
    arriveDate: parseOptionalDate(body.arriveDate, "arriveDate"),
    nights: parseOptionalInt(body.nights, "nights"),
    distanceKm: parseOptionalFloat(body.distanceKm, "distanceKm"),
    note: optionalString(body.note, "note"),
    placeId: optionalString(body.placeId, "placeId"),
  };
}

function buildNewStop(
  tripId: string,
  sortOrder: number,
  parsed: ReturnType<typeof parseStopBody>,
): NewStop {
  return {
    id: crypto.randomUUID(),
    tripId,
    name: parsed.name,
    status: parsed.status,
    sortOrder,
    arriveDate: toNullable(parsed.arriveDate),
    nights: toNullable(parsed.nights),
    distanceKm: toNullable(parsed.distanceKm),
    note: toNullable(parsed.note),
    placeId: toNullable(parsed.placeId),
  };
}

export default defineEventHandler(async (event): Promise<TripStop> => {
  const tripId = requireTripId(event);

  const trip = await loadOwnedTrip(event, tripId);

  const body = await readBody(event);
  const parsed = parseStopBody(body ?? {});

  const database = getDb();

  // Reject a foreign/nonexistent place before writing: a placeId the trip owner
  // doesn't own would otherwise dangle this stop off another user's place.
  await assertPlaceOwnedIfPresent(database, trip.userId, parsed.placeId);

  const sortOrder = await getNextSortOrder(database, tripId);
  const newStop = buildNewStop(tripId, sortOrder, parsed);

  const [inserted] = await database
    .insert(tripStops)
    .values(newStop)
    .returning();

  return inserted;
});
