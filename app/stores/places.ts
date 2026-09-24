import { defineStore } from "pinia";
import { extractErrorMessage } from "~/utils/extractErrorMessage";

export interface Place {
  id: string;
  userId: string;
  name: string;
  subtitle: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  // JSON-serialized ISO strings from the API; not Date objects at runtime.
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlaceInput {
  name: string;
  subtitle?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
}

export type UpdatePlaceInput = Partial<CreatePlaceInput>;

export interface FetchPlacesFilters {
  category?: string;
}

export interface FetchPlacesResult {
  places: Place[];
  page: number;
  hasMore: boolean;
}

// Safety net against an infinite loop if the API ever reports `hasMore: true`
// forever (e.g. a server bug) — no user has anywhere near this many places,
// so hitting this cap always indicates a bug, not a real result set.
const MAX_PLACES_PAGES = 500;

function buildPlacesQuery(
  filters: FetchPlacesFilters | undefined,
  page: number,
): string {
  const params = new URLSearchParams({ page: String(page) });

  if (filters?.category) {
    params.set("category", filters.category);
  }

  return `/api/places?${params.toString()}`;
}

export const usePlacesStore = defineStore("places", () => {
  const { apiFetch } = useApiClient();

  const places = ref<Place[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // GET /api/places is paginated server-side to keep each query bounded
  // (see server/api/places/index.get.ts), but every UI consumer (the map,
  // the dashboard pins, the place picker in AppNewEntry) still needs the
  // full list. Rather than invent a partial-list contract for those callers,
  // this walks every page and concatenates the results, so the store's
  // public `places` list keeps behaving like "all of the user's places".
  async function fetchAllPlacesPages(
    filters?: FetchPlacesFilters,
  ): Promise<Place[]> {
    const allPlaces: Place[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      if (page > MAX_PLACES_PAGES) {
        // Bailing out here would silently hand every consumer a truncated
        // list dressed up as the full one — fail loud instead so the UI
        // surfaces the failure via the existing error handling below.
        throw new Error(
          `fetchPlaces exceeded ${MAX_PLACES_PAGES} pages — the API kept reporting hasMore: true`,
        );
      }

      const result = await apiFetch<FetchPlacesResult>(
        buildPlacesQuery(filters, page),
      );
      allPlaces.push(...result.places);
      hasMore = result.hasMore;
      page += 1;
    }

    return allPlaces;
  }

  async function fetchPlaces(filters?: FetchPlacesFilters): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      places.value = await fetchAllPlacesPages(filters);
    } catch (fetchError) {
      error.value = extractErrorMessage(fetchError);
      throw fetchError;
    } finally {
      isLoading.value = false;
    }
  }

  async function createPlace(input: CreatePlaceInput): Promise<Place> {
    const created = await apiFetch<Place>("/api/places", {
      method: "POST",
      body: input,
    });

    places.value = [...places.value, created];

    return created;
  }

  async function updatePlace(
    id: string,
    input: UpdatePlaceInput,
  ): Promise<Place> {
    const updated = await apiFetch<Place>(`/api/places/${id}`, {
      method: "PATCH",
      body: input,
    });

    places.value = places.value.map((place) =>
      place.id === id ? updated : place,
    );

    return updated;
  }

  async function deletePlace(id: string): Promise<void> {
    await apiFetch(`/api/places/${id}`, { method: "DELETE" });

    places.value = places.value.filter((place) => place.id !== id);
  }

  return {
    places,
    isLoading,
    error,
    fetchPlaces,
    createPlace,
    updatePlace,
    deletePlace,
  };
});
