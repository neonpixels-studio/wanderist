import { eq } from "drizzle-orm";
import { getDb } from "../../db/index";
import { trips, TRIP_STATUS, VISIBILITY } from "../../db/schema";
import { optionalString } from "../../utils/db-helpers";
import {
  parseOptionalEnum,
  parseOptionalDate,
  setIfDefined,
} from "../../utils/validation";
import { requireTripId, loadOwnedTrip } from "../../utils/trip-helpers";
import {
  deleteMediaIfUnreferenced,
  assertCoverImageOwned,
} from "../../utils/coverImageCleanup";
import { assertActiveTripLimit } from "../../utils/planLimits";
import { isTripCountedAsActive } from "../../utils/tripStatus";

type Trip = typeof trips.$inferSelect;
type Database = ReturnType<typeof getDb>;
type TripPatchFields = Partial<typeof trips.$inferInsert>;

const VALID_STATUSES = [
  TRIP_STATUS.ONGOING,
  TRIP_STATUS.UPCOMING,
  TRIP_STATUS.PAST,
] as const;

const VALID_VISIBILITIES = [VISIBILITY.PRIVATE, VISIBILITY.PUBLIC] as const;

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

function parseCoverImageId(
  body: Record<string, unknown>,
): string | null | undefined {
  // null explicitly clears the cover; optionalString would collapse it to
  // undefined (meaning "absent"), so handle it before delegating type-checking.
  if (body.coverImageId === null) {
    return null;
  }

  const value = optionalString(body.coverImageId, "coverImageId");

  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    throw createError({
      statusCode: 400,
      statusMessage:
        "coverImageId must be a non-empty string or null when provided",
    });
  }

  return trimmed;
}

function buildPatchFields(body: Record<string, unknown>): TripPatchFields {
  const fields: TripPatchFields = {};

  setIfDefined(fields, "name", parseName(body));
  setIfDefined(
    fields,
    "status",
    parseOptionalEnum(body.status, VALID_STATUSES, "status"),
  );
  setIfDefined(
    fields,
    "visibility",
    parseOptionalEnum(body.visibility, VALID_VISIBILITIES, "visibility"),
  );
  setIfDefined(
    fields,
    "startDate",
    parseOptionalDate(body.startDate, "startDate"),
  );
  setIfDefined(fields, "endDate", parseOptionalDate(body.endDate, "endDate"));
  setIfDefined(fields, "coverImageId", parseCoverImageId(body));

  return fields;
}

function resolveDate(
  patched: Date | null | undefined,
  existing: Date | null | undefined,
): Date | null | undefined {
  return patched === undefined ? existing : patched;
}

function validateEffectiveDateRange(
  existing: Trip,
  fields: TripPatchFields,
): void {
  const effectiveStart = resolveDate(fields.startDate, existing.startDate);
  const effectiveEnd = resolveDate(fields.endDate, existing.endDate);

  if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
    throw createError({
      statusCode: 400,
      statusMessage: "endDate must be on or after startDate",
    });
  }
}

function requireNonEmptyPatch(fields: TripPatchFields): void {
  if (Object.keys(fields).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No valid fields provided to update",
    });
  }
}

function willBecomeActive(
  existing: Trip,
  patchFields: TripPatchFields,
): boolean {
  const effectiveStatus = patchFields.status ?? existing.status;
  const effectiveEndDate = resolveDate(patchFields.endDate, existing.endDate);
  return isTripCountedAsActive({
    status: effectiveStatus,
    endDate: effectiveEndDate,
  });
}

// Mirrors the normalization in server/api/trips/index.post.ts: if the patch
// would leave the trip with an elapsed endDate but a non-"past" status
// (whether that mismatch comes from this patch's own status/endDate, or was
// already sitting on the row), force the stored status down to "past" so it
// can never render as ongoing/upcoming while isTripCountedAsActive already
// excludes it from the active-trip count. Mutates `patchFields` in place —
// callers apply it before the DB `.set()` call.
function normalizeStaleStatus(
  existing: Trip,
  patchFields: TripPatchFields,
): void {
  if (willBecomeActive(existing, patchFields)) {
    return;
  }

  const resolvedStatus = patchFields.status ?? existing.status;
  if (resolvedStatus === TRIP_STATUS.PAST) {
    return;
  }

  patchFields.status = TRIP_STATUS.PAST;
}

// Re-runs the active-trip limit check when a patch would flip a trip that
// currently doesn't count against the limit (past, or past its endDate)
// into one that does (e.g. re-dating a stale trip into the future, or
// un-marking it "past") — otherwise a user could route around the limit
// enforced on create by patching an inactive trip back to active.
async function assertLimitIfBecomingActive(
  userId: string,
  existing: Trip,
  patchFields: TripPatchFields,
): Promise<void> {
  if (isTripCountedAsActive(existing)) {
    return;
  }

  if (!willBecomeActive(existing, patchFields)) {
    return;
  }

  await assertActiveTripLimit(userId);
}

// Returns the media id the patch replaced (so it can be cleaned up), or null
// when the cover did not change or there was no previous cover to release.
function replacedCoverMediaId(
  existing: Trip,
  patchFields: TripPatchFields,
): string | null {
  const nextCoverImageId = patchFields.coverImageId;
  const previousCoverImageId = existing.coverImageId;

  if (nextCoverImageId === undefined) {
    return null;
  }

  if (nextCoverImageId === previousCoverImageId) {
    return null;
  }

  return previousCoverImageId ?? null;
}

// Best-effort: a failed cover cleanup must not fail an otherwise-successful
// trip update. The old media is only orphaned, not corrupt, so we log and move
// on rather than surfacing a 500 to the user.
async function cleanupReplacedCover(
  database: Database,
  existing: Trip,
  patchFields: TripPatchFields,
): Promise<void> {
  const mediaId = replacedCoverMediaId(existing, patchFields);

  if (mediaId === null) {
    return;
  }

  try {
    await deleteMediaIfUnreferenced(database, existing.userId, mediaId);
  } catch (cleanupError) {
    console.error(
      `trip patch: cover image cleanup failed for ${mediaId}`,
      cleanupError,
    );
  }
}

export default defineEventHandler(async (event): Promise<Trip> => {
  const tripId = requireTripId(event);

  const existing = await loadOwnedTrip(event, tripId);

  const body = await readBody(event);
  const patchFields = buildPatchFields(body ?? {});

  validateEffectiveDateRange(existing, patchFields);
  requireNonEmptyPatch(patchFields);
  await assertLimitIfBecomingActive(existing.userId, existing, patchFields);
  normalizeStaleStatus(existing, patchFields);

  const database = getDb();

  const nextCoverImageId = patchFields.coverImageId;
  if (typeof nextCoverImageId === "string") {
    await assertCoverImageOwned(database, existing.userId, nextCoverImageId);
  }

  const [updated] = await database
    .update(trips)
    .set(patchFields)
    .where(eq(trips.id, tripId))
    .returning();

  // The trip could be deleted between the ownership load and this update; skip
  // cleanup (which would delete media for an update that never landed) and 404.
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Trip not found" });
  }

  await cleanupReplacedCover(database, existing, patchFields);

  return updated;
});
