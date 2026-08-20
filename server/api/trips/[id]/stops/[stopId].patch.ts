import { eq } from "drizzle-orm";
import { getDb } from "../../../../db/index";
import { tripStops, TRIP_STOP_STATUS } from "../../../../db/schema";
import { optionalString } from "../../../../utils/db-helpers";
import { assertPlaceOwnedIfPresent } from "../../../../utils/place-helpers";
import {
  parseOptionalEnum,
  parseOptionalDate,
  parseOptionalInt,
  parseOptionalFloat,
  setIfDefined,
} from "../../../../utils/validation";
import {
  requireTripId,
  requireStopId,
  loadOwnedTrip,
  loadTripStop,
} from "../../../../utils/trip-helpers";

type TripStop = typeof tripStops.$inferSelect;
type StopPatchFields = Partial<typeof tripStops.$inferInsert>;

const VALID_STOP_STATUSES = [
  TRIP_STOP_STATUS.DONE,
  TRIP_STOP_STATUS.NEXT,
  TRIP_STOP_STATUS.PLANNED,
] as const;

function parseName(body: Record<string, unknown>): string | undefined {
  const name = optionalString(body.name, "name");

  if (name === undefined) {
    return undefined;
  }

  const trimmed = name.trim();

  if (trimmed === "") {
    throw createError({
      statusCode: 400,
      statusMessage: "name must be a non-empty string when provided",
    });
  }

  return trimmed;
}

function buildPatchFields(body: Record<string, unknown>): StopPatchFields {
  const fields: StopPatchFields = {};

  setIfDefined(fields, "name", parseName(body));
  setIfDefined(
    fields,
    "status",
    parseOptionalEnum(body.status, VALID_STOP_STATUSES, "status"),
  );
  setIfDefined(
    fields,
    "arriveDate",
    parseOptionalDate(body.arriveDate, "arriveDate"),
  );
  setIfDefined(fields, "nights", parseOptionalInt(body.nights, "nights"));
  setIfDefined(
    fields,
    "distanceKm",
    parseOptionalFloat(body.distanceKm, "distanceKm"),
  );
  setIfDefined(fields, "note", optionalString(body.note, "note"));
  setIfDefined(fields, "placeId", optionalString(body.placeId, "placeId"));

  return fields;
}

function requireNonEmptyPatch(fields: StopPatchFields): void {
  if (Object.keys(fields).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No valid fields provided to update",
    });
  }
}

export default defineEventHandler(async (event): Promise<TripStop> => {
  const tripId = requireTripId(event);
  const stopId = requireStopId(event);

  const trip = await loadOwnedTrip(event, tripId);

  const database = getDb();

  await loadTripStop(database, tripId, stopId);

  const body = await readBody(event);
  const patchFields = buildPatchFields(body ?? {});

  requireNonEmptyPatch(patchFields);

  // Reject a foreign/nonexistent place before writing: a placeId the trip owner
  // doesn't own would otherwise re-point this stop at another user's place. A
  // no-op when the patch does not touch placeId.
  await assertPlaceOwnedIfPresent(database, trip.userId, patchFields.placeId);

  const [updated] = await database
    .update(tripStops)
    .set(patchFields)
    .where(eq(tripStops.id, stopId))
    .returning();

  return updated;
});
