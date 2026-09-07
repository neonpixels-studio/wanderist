import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// useApiClient is a Nuxt auto-imported composable. Stub it before importing
// the store so the module resolves against a controlled mock.
const mockApiFetch = vi.fn();
vi.stubGlobal("useApiClient", () => ({ apiFetch: mockApiFetch }));

// Import after globals are set. trips.ts imports defineStore directly from
// "pinia" (not via a Nuxt auto-import), so no defineStore global stub is
// needed here — a plain import of the real pinia already resolves it.
const { useTripsStore } = await import("../trips");
import type { TripDetail } from "../trips";

const SAMPLE_TRIP_DETAIL: TripDetail = {
  trip: {
    id: "trip-1",
    userId: "user-1",
    name: "Iceland, the ring road",
    status: "upcoming",
    startDate: null,
    endDate: null,
    coverImageId: null,
    distanceKm: 1332,
    visibility: "public",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  stops: [],
  facts: {
    distanceKm: 1332,
    loggedDistanceKm: null,
    nights: null,
    photoCount: 0,
    stopCount: 0,
  },
};

describe("useTripsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe("fetchTripById", () => {
    it("populates currentTripDetail on success", async () => {
      mockApiFetch.mockResolvedValueOnce(SAMPLE_TRIP_DETAIL);
      const store = useTripsStore();

      await store.fetchTripById("trip-1");

      expect(store.currentTripDetail).toEqual(SAMPLE_TRIP_DETAIL);
      expect(store.isLoadingDetail).toBe(false);
      expect(store.detailError).toBeNull();
      expect(store.detailNotFound).toBe(false);
    });

    it("calls GET /api/trips/:id", async () => {
      mockApiFetch.mockResolvedValue(SAMPLE_TRIP_DETAIL);
      const store = useTripsStore();

      await store.fetchTripById("trip-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/trips/trip-1");
    });

    it("sets detailNotFound (not detailError) on a 404, so a private/missing trip renders not-found rather than a retry prompt", async () => {
      const notFoundError = Object.assign(new Error("Not Found"), {
        statusCode: 404,
      });
      mockApiFetch.mockRejectedValue(notFoundError);
      const store = useTripsStore();

      await expect(store.fetchTripById("trip-missing")).rejects.toThrow();

      expect(store.currentTripDetail).toBeNull();
      expect(store.detailNotFound).toBe(true);
      expect(store.detailError).toBeNull();
    });

    it("sets detailNotFound (not detailError) on a 401, since a stale/expired token isn't fixed by retrying", async () => {
      // server/middleware/auth.ts 401s a request that sends a token that
      // fails verification (expired/revoked session) rather than silently
      // demoting the owner to a non-owner — that's not retryable with the
      // same token, so it gets the same not-found + sign-in treatment as 404.
      const unauthorizedError = Object.assign(new Error("Unauthorized"), {
        statusCode: 401,
      });
      mockApiFetch.mockRejectedValue(unauthorizedError);
      const store = useTripsStore();

      await expect(store.fetchTripById("trip-1")).rejects.toThrow();

      expect(store.currentTripDetail).toBeNull();
      expect(store.detailNotFound).toBe(true);
      expect(store.detailError).toBeNull();
    });

    it("sets detailError (not detailNotFound) on a 5xx, so a share-link visitor sees a retryable error instead of the trip looking deleted", async () => {
      const serverError = Object.assign(new Error("Internal Server Error"), {
        statusCode: 500,
      });
      mockApiFetch.mockRejectedValue(serverError);
      const store = useTripsStore();

      await expect(store.fetchTripById("trip-1")).rejects.toThrow();

      expect(store.currentTripDetail).toBeNull();
      expect(store.detailNotFound).toBe(false);
      expect(store.detailError).toBe("Internal Server Error");
    });

    it("sets detailError (not detailNotFound) on a network failure with no status code", async () => {
      mockApiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
      const store = useTripsStore();

      await expect(store.fetchTripById("trip-1")).rejects.toThrow();

      expect(store.detailNotFound).toBe(false);
      expect(store.detailError).toBe("Failed to fetch");
    });

    it("clears a stale trip on failure when nothing valid is displayed for the requested id", async () => {
      mockApiFetch.mockResolvedValueOnce(SAMPLE_TRIP_DETAIL);
      const store = useTripsStore();
      await store.fetchTripById("trip-1");
      expect(store.currentTripDetail).not.toBeNull();

      // Navigating to a DIFFERENT trip that then fails leaves nothing valid to
      // show for trip-2, so the stale trip-1 content must not linger.
      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Internal Server Error"), {
          statusCode: 500,
        }),
      );
      await expect(store.fetchTripById("trip-2")).rejects.toThrow();

      expect(store.currentTripDetail).toBeNull();
    });

    it("keeps the already-displayed trip when a retryable background refetch of the SAME id fails", async () => {
      // Regression guard: trips/[id].vue re-fetches once Clerk resolves
      // (canRetryAuthenticated), which can race a transient failure after the
      // trip already loaded successfully. A blip must not blank a good trip.
      mockApiFetch.mockResolvedValueOnce(SAMPLE_TRIP_DETAIL);
      const store = useTripsStore();
      await store.fetchTripById("trip-1");
      expect(store.currentTripDetail).toEqual(SAMPLE_TRIP_DETAIL);

      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Internal Server Error"), {
          statusCode: 500,
        }),
      );
      await expect(store.fetchTripById("trip-1")).rejects.toThrow();

      expect(store.currentTripDetail).toEqual(SAMPLE_TRIP_DETAIL);
      expect(store.detailError).toBe("Internal Server Error");
    });

    it("clears the already-displayed trip on a 404/401 even when it was loaded for the same id", async () => {
      // Unlike a retryable failure, a 404/401 means the viewer may no longer
      // be entitled to see this trip (e.g. an expired session or the owner
      // revoked sharing), so it must not keep showing stale content.
      mockApiFetch.mockResolvedValueOnce(SAMPLE_TRIP_DETAIL);
      const store = useTripsStore();
      await store.fetchTripById("trip-1");
      expect(store.currentTripDetail).not.toBeNull();

      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
      );
      await expect(store.fetchTripById("trip-1")).rejects.toThrow();

      expect(store.currentTripDetail).toBeNull();
      expect(store.detailNotFound).toBe(true);
    });

    it("resets detailError and detailNotFound at the start of each call", async () => {
      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Not Found"), { statusCode: 404 }),
      );
      const store = useTripsStore();
      await expect(store.fetchTripById("trip-1")).rejects.toThrow();
      expect(store.detailNotFound).toBe(true);

      mockApiFetch.mockResolvedValueOnce(SAMPLE_TRIP_DETAIL);
      await store.fetchTripById("trip-1");

      expect(store.detailNotFound).toBe(false);
      expect(store.detailError).toBeNull();
    });

    it("sets isLoadingDetail true during the fetch and false after", async () => {
      let resolveFetch!: (value: TripDetail) => void;
      mockApiFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const store = useTripsStore();

      const pending = store.fetchTripById("trip-1");
      expect(store.isLoadingDetail).toBe(true);

      resolveFetch(SAMPLE_TRIP_DETAIL);
      await pending;

      expect(store.isLoadingDetail).toBe(false);
    });

    it("drops a stale success so an older, slower request can't overwrite a newer trip", async () => {
      // Regression guard: a fire-and-forget caller elsewhere in the app (e.g.
      // home.vue prefetching the dashboard's "ongoing trip") can race the trip
      // detail page's own fetch for a different trip id. Without a request-id
      // guard, whichever settles last wins even if it's the stale one.
      const slowTrip: TripDetail = {
        ...SAMPLE_TRIP_DETAIL,
        trip: { ...SAMPLE_TRIP_DETAIL.trip, id: "trip-slow", name: "Slow" },
      };
      const fastTrip: TripDetail = {
        ...SAMPLE_TRIP_DETAIL,
        trip: { ...SAMPLE_TRIP_DETAIL.trip, id: "trip-fast", name: "Fast" },
      };

      let resolveSlow!: (value: TripDetail) => void;
      mockApiFetch
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSlow = resolve;
            }),
        )
        .mockResolvedValueOnce(fastTrip);

      const store = useTripsStore();
      const slow = store.fetchTripById("trip-slow");
      await store.fetchTripById("trip-fast");

      resolveSlow(slowTrip);
      await slow;

      expect(store.currentTripDetail).toEqual(fastTrip);
    });

    it("does not clobber a newer request's loaded trip when an older, superseded request fails late", async () => {
      let rejectFirst!: (reason: Error) => void;
      mockApiFetch
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectFirst = reject;
            }),
        )
        .mockResolvedValueOnce(SAMPLE_TRIP_DETAIL);

      const store = useTripsStore();
      const first = store.fetchTripById("trip-1");
      await store.fetchTripById("trip-1");

      rejectFirst(
        Object.assign(new Error("Internal Server Error"), {
          statusCode: 500,
        }),
      );
      await expect(first).rejects.toThrow("Internal Server Error");

      // The late failure from the superseded call must not blank the trip or
      // surface a stale error over the already-loaded state.
      expect(store.currentTripDetail).toEqual(SAMPLE_TRIP_DETAIL);
      expect(store.detailError).toBeNull();
      expect(store.detailNotFound).toBe(false);
    });
  });
});
