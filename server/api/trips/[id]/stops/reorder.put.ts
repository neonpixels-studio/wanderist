import { and, eq, inArray } from "drizzle-orm";
import { getDb, runBatch } from "../../../../db/index";
import { tripStops } from "../../../../db/schema";
import { requireTripId, loadOwnedTrip } from "../../../../utils/trip-helpers";

type Database = ReturnType<typeof getDb>;

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: "stopIds must be an array of strings",
    });
  }

  if (value.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "stopIds must not be empty",
    });
  }

  return value;
}

function requireStringItems(items: unknown[]): string[] {
  if (items.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw createError({
      statusCode: 400,
      statusMessage: "Each stopId must be a non-empty string",
    });
  }

  return items as string[];
}

function requireUniqueItems(items: string[]): void {
  if (new Set(items).size !== items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: "stopIds must not contain duplicates",
    });
  }
}

function parseStopIds(value: unknown): string[] {
  const items = requireArray(value);
  const stringItems = requireStringItems(items);
  requireUniqueItems(stringItems);
  return stringItems;
}

async function fetchTripStopIds(
  database: Database,
  tripId: string,
): Promise<string[]> {
  const rows = await database
    .select({ id: tripStops.id })
    .from(tripStops)
    .where(eq(tripStops.tripId, tripId));

  return rows.map((row) => row.id);
}

function validateAllStopsPresent(
  requestedIds: string[],
  existingIds: string[],
): void {
  const existingSet = new Set(existingIds);
  const missing = requestedIds.filter((id) => !existingSet.has(id));

  if (missing.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Stop ids not found on this trip: ${missing.join(", ")}`,
    });
  }

  if (requestedIds.length !== existingIds.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Reorder list must include all ${existingIds.length} stops; received ${requestedIds.length}`,
    });
  }
}

export default defineEventHandler(async (event) => {
  const tripId = requireTripId(event);

  await loadOwnedTrip(event, tripId);

  const body = await readBody(event);
  const stopIds = parseStopIds(body?.stopIds);

  const database = getDb();
  const existingIds = await fetchTripStopIds(database, tripId);

  validateAllStopsPresent(stopIds, existingIds);

  // Each stop's new sortOrder is already known (its index in the caller's
  // list), so none of these updates depends on another's result — they run as
  // ONE atomic database.batch() call, the neon-http driver's real BEGIN/COMMIT
  // unit (see server/db/index.ts), instead of the previous Promise.all of
  // independent HTTP calls where a mid-sequence failure could leave the trip's
  // stops in a half-reordered state. Each UPDATE holds its row lock for the
  // life of that one transaction (unlike the old Promise.all, where every
  // update auto-committed and released its lock immediately), so two
  // concurrent reorders of the same trip in different orders would deadlock if
  // each locked rows in the caller's order. Locking in a fixed, sorted-by-id
  // order (same fix as upsertTags in server/utils/entry-helpers.ts) makes any
  // two callers acquire the same rows in the same order; sortOrder still comes
  // from each stop's index in the caller's original list, so the result is
  // unaffected — only lock acquisition order changes.
  const sortOrderByStopId = new Map(
    stopIds.map((stopId, index) => [stopId, index]),
  );
  const lockOrderedStopIds = [...stopIds].sort();
  const updateStatements = lockOrderedStopIds.map((stopId) =>
    database
      .update(tripStops)
      .set({ sortOrder: sortOrderByStopId.get(stopId)! })
      .where(and(eq(tripStops.id, stopId), eq(tripStops.tripId, tripId))),
  );
  await runBatch(database, updateStatements);

  const reorderedStops = await database
    .select()
    .from(tripStops)
    .where(inArray(tripStops.id, stopIds));

  reorderedStops.sort((a, b) => stopIds.indexOf(a.id) - stopIds.indexOf(b.id));

  return reorderedStops;
});
