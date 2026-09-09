import { defineStore } from "pinia";
import { extractErrorMessage } from "~/utils/extractErrorMessage";
import { isNotFoundError } from "~/utils/isNotFoundError";
import type { TripStatus } from "~/utils/tripDates";

type TripVisibility = "private" | "public";
type TripStopStatus = "done" | "next" | "planned";

export interface Trip {
  id: string;
  userId: string;
  name: string;
  status: TripStatus;
  startDate: string | null;
  endDate: string | null;
  coverImageId: string | null;
  distanceKm: number | null;
  visibility: TripVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface TripStop {
  id: string;
  tripId: string;
  placeId: string | null;
  name: string;
  sortOrder: number;
  arriveDate: string | null;
  nights: number | null;
  note: string | null;
  distanceKm: number | null;
  status: TripStopStatus;
}

export interface TripFacts {
  distanceKm: number | null;
  loggedDistanceKm: number | null;
  nights: number | null;
  photoCount: number;
  stopCount: number;
}

export interface TripDetail {
  trip: Trip;
  stops: TripStop[];
  facts: TripFacts;
}

export interface CreateTripPayload {
  name: string;
  status?: TripStatus;
  visibility?: TripVisibility;
  startDate?: string | null;
  endDate?: string | null;
}

export interface PatchTripPayload {
  name?: string;
  status?: TripStatus;
  visibility?: TripVisibility;
  startDate?: string | null;
  endDate?: string | null;
}

export interface CreateStopPayload {
  name: string;
  status?: TripStopStatus;
  arriveDate?: string | null;
  nights?: number | null;
  distanceKm?: number | null;
  note?: string | null;
  placeId?: string | null;
}

export interface PatchStopPayload {
  name?: string;
  status?: TripStopStatus;
  arriveDate?: string | null;
  nights?: number | null;
  distanceKm?: number | null;
  note?: string | null;
  placeId?: string | null;
}

export interface FetchTripsFilters {
  status?: TripStatus | "All";
  sort?: "asc" | "desc";
}

export interface FetchTripsResult {
  trips: Trip[];
  page: number;
  hasMore: boolean;
}

// Safety net against an infinite loop if the API ever reports `hasMore: true`
// forever (e.g. a server bug) — no user has anywhere near this many trips,
// so hitting this cap always indicates a bug, not a real result set.
const MAX_TRIPS_PAGES = 500;

function buildTripsQuery(
  filters: FetchTripsFilters | undefined,
  page: number,
): string {
  const params = new URLSearchParams({ page: String(page) });

  if (filters?.status && filters.status !== "All") {
    params.set("status", filters.status);
  }

  if (filters?.sort) {
    params.set("sort", filters.sort);
  }

  return `/api/trips?${params.toString()}`;
}

export const useTripsStore = defineStore("trips", () => {
  const { apiFetch } = useApiClient();

  const tripList = ref<Trip[]>([]);
  const currentTripDetail = ref<TripDetail | null>(null);
  const isLoadingList = ref(false);
  const isLoadingDetail = ref(false);
  const listError = ref<string | null>(null);
  // detailError carries a message for a retryable failure (5xx, network); a 404
  // instead sets detailNotFound so the page can show "not found" rather than a
  // retry prompt for a private/missing trip a share-link visitor hit.
  const detailError = ref<string | null>(null);
  const detailNotFound = ref(false);

  // GET /api/trips is paginated server-side to keep each query bounded (see
  // server/api/trips/index.get.ts), but every UI consumer of the trips page
  // still needs the full list. Rather than invent a partial-list contract
  // for those callers, this walks every page and concatenates the results,
  // so the store's public `tripList` keeps behaving like "all of the user's
  // trips".
  async function fetchAllTripsPages(
    filters?: FetchTripsFilters,
  ): Promise<Trip[]> {
    const allTrips: Trip[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      if (page > MAX_TRIPS_PAGES) {
        // Bailing out here would silently hand every consumer a truncated
        // list dressed up as the full one — fail loud instead so the UI
        // surfaces the failure via the existing error handling below.
        throw new Error(
          `fetchTrips exceeded ${MAX_TRIPS_PAGES} pages — the API kept reporting hasMore: true`,
        );
      }

      const result = await apiFetch<FetchTripsResult>(
        buildTripsQuery(filters, page),
      );

      if (
        !Array.isArray(result?.trips) ||
        typeof result?.hasMore !== "boolean"
      ) {
        throw new Error(
          "Malformed /api/trips response: expected { trips: Trip[], hasMore: boolean }",
        );
      }

      allTrips.push(...result.trips);
      hasMore = result.hasMore;
      page += 1;
    }

    return allTrips;
  }

  async function fetchTrips(params?: FetchTripsFilters): Promise<void> {
    isLoadingList.value = true;
    listError.value = null;

    try {
      tripList.value = await fetchAllTripsPages(params);
    } catch (error) {
      listError.value =
        error instanceof Error ? error.message : "Failed to load trips";
      throw error;
    } finally {
      isLoadingList.value = false;
    }
  }

  // Monotonic request id; a resolved response is applied only if it is still
  // the latest call, so a slower superseded call (e.g. home.vue's fire-and-
  // forget fetch of the dashboard's "ongoing trip" racing the detail page's own
  // fetch for a different trip) can't clobber fresher state on a late success
  // or failure. Mirrors fetchGuideById's latestGuideRequestId in stores/guides.ts.
  let latestDetailRequestId = 0;

  async function fetchTripById(tripId: string): Promise<void> {
    const requestId = ++latestDetailRequestId;
    isLoadingDetail.value = true;
    detailError.value = null;
    detailNotFound.value = false;

    try {
      const detail = await apiFetch<TripDetail>(`/api/trips/${tripId}`);
      if (requestId !== latestDetailRequestId) {
        return;
      }
      currentTripDetail.value = detail;
    } catch (error) {
      if (requestId !== latestDetailRequestId) {
        throw error;
      }
      // A 404 means the trip is genuinely gone or private — always clear any
      // stale trip so the not-found state (with its sign-in affordance)
      // renders rather than content the viewer may no longer be entitled to
      // see. A retryable failure (5xx/401/network) only clears the trip when
      // nothing valid is already displayed for this id; a background refetch
      // of the trip already on screen (e.g. the owner's re-fetch once Clerk
      // resolves, watched in trips/[id].vue) keeps showing that still-valid
      // content instead of blanking it on a blip. A 401 belongs in this
      // retryable bucket, not not-found: apiFetch mints a fresh token per
      // call, so "try again" can genuinely fix a token that expired in flight.
      const tripIsGenuinelyMissing = isNotFoundError(error);
      if (
        tripIsGenuinelyMissing ||
        currentTripDetail.value?.trip.id !== tripId
      ) {
        currentTripDetail.value = null;
      }
      if (tripIsGenuinelyMissing) {
        detailNotFound.value = true;
      } else {
        detailError.value = extractErrorMessage(error);
      }
      throw error;
    } finally {
      if (requestId === latestDetailRequestId) {
        isLoadingDetail.value = false;
      }
    }
  }

  async function createTrip(payload: CreateTripPayload): Promise<Trip> {
    const trip = await apiFetch<Trip>("/api/trips", {
      method: "POST",
      body: payload,
    });

    tripList.value = [trip, ...tripList.value];

    return trip;
  }

  async function patchTrip(
    tripId: string,
    payload: PatchTripPayload,
  ): Promise<Trip> {
    const updated = await apiFetch<Trip>(`/api/trips/${tripId}`, {
      method: "PATCH",
      body: payload,
    });

    tripList.value = tripList.value.map((trip) =>
      trip.id === tripId ? updated : trip,
    );

    if (currentTripDetail.value?.trip.id === tripId) {
      currentTripDetail.value = {
        ...currentTripDetail.value,
        trip: updated,
      };
    }

    return updated;
  }

  async function deleteTrip(tripId: string): Promise<void> {
    await apiFetch(`/api/trips/${tripId}`, { method: "DELETE" });

    tripList.value = tripList.value.filter((trip) => trip.id !== tripId);

    if (currentTripDetail.value?.trip.id === tripId) {
      currentTripDetail.value = null;
    }
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

  function recomputeFacts(
    existingFacts: TripFacts,
    stops: TripStop[],
  ): TripFacts {
    return {
      distanceKm: existingFacts.distanceKm,
      loggedDistanceKm: sumNullableField(stops, "distanceKm"),
      nights: sumNullableField(stops, "nights"),
      photoCount: existingFacts.photoCount,
      stopCount: stops.length,
    };
  }

  async function createStop(
    tripId: string,
    payload: CreateStopPayload,
  ): Promise<TripStop> {
    const stop = await apiFetch<TripStop>(`/api/trips/${tripId}/stops`, {
      method: "POST",
      body: payload,
    });

    if (currentTripDetail.value?.trip.id === tripId) {
      const updatedStops = [...currentTripDetail.value.stops, stop];
      currentTripDetail.value = {
        ...currentTripDetail.value,
        stops: updatedStops,
        facts: recomputeFacts(currentTripDetail.value.facts, updatedStops),
      };
    }

    return stop;
  }

  async function patchStop(
    tripId: string,
    stopId: string,
    payload: PatchStopPayload,
  ): Promise<TripStop> {
    const updated = await apiFetch<TripStop>(
      `/api/trips/${tripId}/stops/${stopId}`,
      { method: "PATCH", body: payload },
    );

    if (currentTripDetail.value?.trip.id === tripId) {
      const updatedStops = currentTripDetail.value.stops.map((stop) =>
        stop.id === stopId ? updated : stop,
      );
      currentTripDetail.value = {
        ...currentTripDetail.value,
        stops: updatedStops,
        facts: recomputeFacts(currentTripDetail.value.facts, updatedStops),
      };
    }

    return updated;
  }

  async function deleteStop(tripId: string, stopId: string): Promise<void> {
    await apiFetch(`/api/trips/${tripId}/stops/${stopId}`, {
      method: "DELETE",
    });

    if (currentTripDetail.value?.trip.id === tripId) {
      const updatedStops = currentTripDetail.value.stops.filter(
        (stop) => stop.id !== stopId,
      );
      currentTripDetail.value = {
        ...currentTripDetail.value,
        stops: updatedStops,
        facts: recomputeFacts(currentTripDetail.value.facts, updatedStops),
      };
    }
  }

  async function reorderStops(
    tripId: string,
    stopIds: string[],
  ): Promise<TripStop[]> {
    const reordered = await apiFetch<TripStop[]>(
      `/api/trips/${tripId}/stops/reorder`,
      { method: "PUT", body: { stopIds } },
    );

    if (currentTripDetail.value?.trip.id === tripId) {
      currentTripDetail.value = {
        ...currentTripDetail.value,
        stops: reordered,
      };
    }

    return reordered;
  }

  return {
    tripList,
    currentTripDetail,
    isLoadingList,
    isLoadingDetail,
    listError,
    detailError,
    detailNotFound,
    fetchTrips,
    fetchTripById,
    createTrip,
    patchTrip,
    deleteTrip,
    createStop,
    patchStop,
    deleteStop,
    reorderStops,
  };
});
