/**
 * useSearch — calls GET /api/search?q= and returns grouped, UI-ready result
 * items. All five groups (places, trips, entries, guides, people) map to the same
 * SearchItem shape that AppCommandPalette, explore, and map already use.
 */

import { DEFAULT_TRAVELER_NAME, formatHandle } from "~/utils/travelerLabels";

export interface SearchItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  href: string;
}

export interface SearchGroups {
  places: SearchItem[];
  trips: SearchItem[];
  entries: SearchItem[];
  guides: SearchItem[];
  people: SearchItem[];
}

interface PlaceResult {
  id: string;
  name: string;
  subtitle: string | null;
  country: string | null;
  category: string | null;
}

interface TripResult {
  id: string;
  name: string;
  status: string;
}

interface EntryResult {
  id: string;
  title: string;
}

interface GuideResult {
  id: string;
  title: string;
}

interface PersonResult {
  id: string;
  displayName: string | null;
  handle: string | null;
}

interface SearchApiResponse {
  places: PlaceResult[];
  trips: TripResult[];
  entries: EntryResult[];
  guides: GuideResult[];
  people: PersonResult[];
}

const MAX_QUERY_LENGTH = 100;
const DEBOUNCE_MS = 250;

// Factory to avoid sharing array references across resets and initializations.
function emptyGroups(): SearchGroups {
  return { places: [], trips: [], entries: [], guides: [], people: [] };
}

function mapPlace(place: PlaceResult): SearchItem {
  const subtitle =
    [place.subtitle, place.country].filter(Boolean).join(" · ") || undefined;
  return {
    id: place.id,
    title: place.name,
    subtitle,
    icon: "pin",
    href: "/map",
  };
}

function mapTrip(trip: TripResult): SearchItem {
  return {
    id: trip.id,
    title: trip.name,
    subtitle: trip.status,
    icon: "route",
    href: `/trips/${trip.id}`,
  };
}

function mapEntry(entry: EntryResult): SearchItem {
  return {
    id: entry.id,
    title: entry.title,
    icon: "journal",
    href: "/journal",
  };
}

function mapGuide(guide: GuideResult): SearchItem {
  return {
    id: guide.id,
    title: guide.title,
    icon: "layers",
    href: "/guides",
  };
}

function mapPerson(person: PersonResult): SearchItem {
  const title =
    formatHandle(person.handle) ||
    (person.displayName ?? DEFAULT_TRAVELER_NAME);
  const subtitle =
    person.displayName && person.handle ? person.displayName : undefined;
  return {
    id: person.id,
    title,
    subtitle,
    icon: "user",
    href: `/u/${encodeURIComponent(person.id)}`,
  };
}

function mapApiResponse(response: SearchApiResponse): SearchGroups {
  return {
    places: response.places.map(mapPlace),
    trips: response.trips.map(mapTrip),
    entries: response.entries.map(mapEntry),
    guides: response.guides.map(mapGuide),
    people: response.people.map(mapPerson),
  };
}

/**
 * Provides a reactive search composable backed by GET /api/search?q=.
 *
 * - `query`: the search string to bind to an input
 * - `results`: reactive grouped search results (empty until query is non-empty)
 * - `isLoading`: true while the fetch is in flight
 * - `error`: set when the fetch fails; null otherwise
 * - `search`: debounced; call with the current query string to trigger a fetch.
 *   Stale responses are discarded so only the latest request's results apply.
 */
export function useSearch() {
  const { apiFetch } = useApiClient();

  const query = ref("");
  const results = ref<SearchGroups>(emptyGroups());
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Incremented on each search call; checked before applying the response so
  // a slow earlier response cannot overwrite a newer one.
  let activeRequestId = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  onScopeDispose(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
  });

  async function executeSearch(
    searchQuery: string,
    requestId: number,
  ): Promise<void> {
    try {
      const response = await apiFetch<SearchApiResponse>(
        `/api/search?q=${encodeURIComponent(searchQuery)}`,
      );

      if (requestId !== activeRequestId) {
        return;
      }

      results.value = mapApiResponse(response);
    } catch (fetchError) {
      if (requestId !== activeRequestId) {
        return;
      }

      console.error("useSearch: search failed", fetchError);
      error.value = "Search failed. Please try again.";
      results.value = emptyGroups();
    } finally {
      if (requestId === activeRequestId) {
        isLoading.value = false;
      }
    }
  }

  function search(searchQuery: string): void {
    const trimmed = searchQuery.trim().slice(0, MAX_QUERY_LENGTH);

    activeRequestId += 1;

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    if (!trimmed) {
      results.value = emptyGroups();
      isLoading.value = false;
      return;
    }

    // Set loading state synchronously so consumers don't flash empty/error
    // state during the debounce window or in-flight request.
    isLoading.value = true;
    error.value = null;

    const requestId = activeRequestId;

    debounceTimer = setTimeout(() => {
      executeSearch(trimmed, requestId);
    }, DEBOUNCE_MS);
  }

  return {
    query,
    results,
    isLoading,
    error,
    search,
  };
}
