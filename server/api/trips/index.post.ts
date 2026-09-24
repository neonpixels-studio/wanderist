import { getDb } from "../../db/index";
import { trips, TRIP_STATUS, VISIBILITY } from "../../db/schema";
import { ensureUser } from "../../utils/auth";
import { requireString } from "../../utils/db-helpers";
import { parseEnum, parseOptionalDate } from "../../utils/validation";
import { assertActiveTripLimit } from "../../utils/planLimits";
import { isTripCountedAsActive } from "../../utils/tripStatus";

const VALID_STATUSES = [
  TRIP_STATUS.ONGOING,
  TRIP_STATUS.UPCOMING,
  TRIP_STATUS.PAST,
] as const;

const VALID_VISIBILITIES = [VISIBILITY.PRIVATE, VISIBILITY.PUBLIC] as const;

function generateId(): string {
  return crypto.randomUUID();
}

export default defineEventHandler(async (event) => {
  const userId = await ensureUser(event);
  const body = await readBody(event);

  requireString(body?.name, "name");

  const name = body.name as string;
  const status = parseEnum(
    body.status,
    VALID_STATUSES,
    "status",
    TRIP_STATUS.UPCOMING,
  );
  const visibility = parseEnum(
    body.visibility,
    VALID_VISIBILITIES,
    "visibility",
    VISIBILITY.PRIVATE,
  );
  const startDate = parseOptionalDate(body.startDate, "startDate");
  const endDate = parseOptionalDate(body.endDate, "endDate");

  if (startDate && endDate && endDate < startDate) {
    throw createError({
      statusCode: 400,
      statusMessage: "endDate must be on or after startDate",
    });
  }

  // A trip whose dates are already behind it is effectively "past" from the
  // moment it's created, regardless of what status the client requested —
  // storing the raw client value here would let a trip render as
  // ongoing/upcoming (see server/api/trips/index.get.ts's status filter)
  // while the active-trip count (isTripCountedAsActive) silently treats it
  // as past, one rule disagreeing with itself. Normalizing at write time
  // keeps both in agreement; only a trip that's still effectively active
  // needs the limit check.
  const effectiveStatus = isTripCountedAsActive({
    status,
    endDate: endDate ?? null,
  })
    ? status
    : TRIP_STATUS.PAST;

  if (effectiveStatus !== TRIP_STATUS.PAST) {
    await assertActiveTripLimit(userId);
  }

  const database = getDb();

  const newTrip = {
    id: generateId(),
    userId,
    name,
    status: effectiveStatus,
    visibility,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
  };

  const [inserted] = await database.insert(trips).values(newTrip).returning();

  return inserted;
});
