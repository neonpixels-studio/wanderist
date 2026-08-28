import { eq, and, asc, count } from "drizzle-orm";
import { getDb } from "../../db/index";
import {
  trips,
  tripStops,
  entries,
  entryPhotos,
  VISIBILITY,
} from "../../db/schema";
import { requireTripId } from "../../utils/trip-helpers";
import { loadReadableTrip } from "../../utils/trip-queries";
import { optionalUser } from "../../utils/auth";

type Database = ReturnType<typeof getDb>;
type Trip = typeof trips.$inferSelect;
type TripStop = typeof tripStops.$inferSelect;

interface TripFacts {
  distanceKm: number | null;
  loggedDistanceKm: number | null;
  nights: number | null;
  photoCount: number;
  stopCount: number;
}

interface TripDetailResponse {
  trip: Trip;
  stops: TripStop[];
  facts: TripFacts;
}

async function fetchOrderedStops(
  database: Database,
  tripId: string,
): Promise<TripStop[]> {
  return database
    .select()
    .from(tripStops)
    .where(eq(tripStops.tripId, tripId))
    .orderBy(asc(tripStops.sortOrder));
}

async function fetchPhotoCount(
  database: Database,
  tripId: string,
  includePrivateEntries: boolean,
): Promise<number> {
  // A non-owner reading a public trip must not learn how many photos sit on the
  // trip's private entries, so restrict the count to public entries for them.
  // The owner sees the true total.
  const entryFilter = includePrivateEntries
    ? eq(entries.tripId, tripId)
    : and(
        eq(entries.tripId, tripId),
        eq(entries.visibility, VISIBILITY.PUBLIC),
      );

  const rows = await database
    .select({ total: count(entryPhotos.id) })
    .from(entryPhotos)
    .innerJoin(entries, eq(entryPhotos.entryId, entries.id))
    .where(entryFilter);

  return rows[0]?.total ?? 0;
}

function sumNullableField<T extends Record<string, unknown>>(
  items: T[],
  key: keyof T,
): number | null {
  return items.reduce<number | null>((accumulator, item) => {
    const value = item[key];

    if (value === null || value === undefined) {
      return accumulator;
    }

    return (accumulator ?? 0) + (value as number);
  }, null);
}

function computeFacts(
  trip: Trip,
  stops: TripStop[],
  photoCount: number,
): TripFacts {
  return {
    distanceKm: trip.distanceKm ?? null,
    loggedDistanceKm: sumNullableField(stops, "distanceKm"),
    nights: sumNullableField(stops, "nights"),
    photoCount,
    stopCount: stops.length,
  };
}

export default defineEventHandler(
  async (event): Promise<TripDetailResponse> => {
    const tripId = requireTripId(event);

    // Auth is optional here: a shared public trip must open for anonymous
    // visitors. loadReadableTrip still gates strictly — an anonymous (null)
    // reader is a non-owner and reads only public trips; private trips stay
    // hidden behind a 404.
    const userId = optionalUser(event);

    const database = getDb();

    // This response varies by caller (the owner reads a private trip; everyone
    // else gets only public trips or a 404), discriminated by the Authorization
    // header. Forbid shared caching so a proxy/CDN keyed on URL alone can't
    // serve one viewer's private trip to another, and vary on Authorization for
    // any cache that honors it.
    setResponseHeader(event, "Cache-Control", "private, no-store");
    setResponseHeader(event, "Vary", "Authorization");

    const trip = await loadReadableTrip(database, tripId, userId);

    const isOwner = trip.userId === userId;

    const [stops, photoCount] = await Promise.all([
      fetchOrderedStops(database, tripId),
      fetchPhotoCount(database, tripId, isOwner),
    ]);

    const facts = computeFacts(trip, stops, photoCount);

    return { trip, stops, facts };
  },
);
