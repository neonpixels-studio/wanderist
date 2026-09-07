/**
 * useProfile — fetches a public user profile plus its followers, public
 * trips, and public guides.
 *
 * - profile: the loaded profile (null until fetched, or when not viewable)
 * - followers: the profile's public followers
 * - trips: the profile owner's public trips
 * - guides: the profile owner's public guides
 * - notFound: true when the profile does not exist or is private to the viewer
 * - fetchProfile / fetchFollowers / fetchTrips / fetchGuides: load each part
 *   for a given user ID
 *
 * The backend returns 404 both for a missing user and for a private profile the
 * viewer may not see, so the composable cannot (and should not) distinguish
 * them — both surface as `notFound`.
 *
 * fetchProfile aside, the followers/trips/guides fetchers share one identical
 * request lifecycle (bump a request id, clear the list on a profile switch,
 * discard a superseded response, surface a non-404 failure) — see
 * `createListFetcher` — so it lives once instead of three times.
 */

import type { TripStatus } from "~/utils/tripDates";

const NOT_FOUND_STATUS = 404;

export interface ProfileUser {
  userId: string;
  displayName: string | null;
  handle: string | null;
  homeBase: string | null;
  bio: string | null;
  publicProfile: boolean;
  followerCount: number;
  followingCount: number;
  placeCount: number;
  isSelf: boolean;
}

export interface ProfileFollower {
  userId: string;
  displayName: string | null;
  handle: string | null;
}

export interface ProfileTrip {
  id: string;
  name: string;
  status: TripStatus;
  startDate: string | null;
  endDate: string | null;
}

export interface ProfileGuide {
  id: string;
  title: string;
  readTimeMinutes: number;
  likeCount: number;
}

function isNotFound(error: unknown): boolean {
  // ofetch's FetchError exposes statusCode, but be defensive about wrappers that
  // only preserve response.status or a nested data.statusCode — otherwise a
  // private/missing profile would render as a generic error, not "unavailable".
  const candidate = error as {
    statusCode?: number;
    response?: { status?: number };
    data?: { statusCode?: number };
  };
  const status =
    candidate?.statusCode ??
    candidate?.response?.status ??
    candidate?.data?.statusCode;
  return status === NOT_FOUND_STATUS;
}

interface ListFetchState<Item> {
  items: Ref<Item[]>;
  hasMore: Ref<boolean>;
  loading: Ref<boolean>;
  errorMessage: Ref<string | null>;
}

function createListFetchState<Item>(): ListFetchState<Item> {
  return {
    items: ref<Item[]>([]) as Ref<Item[]>,
    // Starts true so the first (pre-fetch) render shows the loading state
    // rather than an empty body; the fetcher flips it false once it settles.
    loading: ref(true),
    hasMore: ref(false),
    errorMessage: ref<string | null>(null),
  };
}

interface ListFetcherConfig<Item, Response> {
  // Path segment after `/api/users/[id]/`, e.g. "followers", "trips", "guides".
  resourcePath: string;
  // Maps the endpoint's response (whose item key differs per resource) to a
  // common `{ items, hasMore }` shape.
  extractPage: (response: Response) => { items: Item[]; hasMore: boolean };
  // Logged (not shown to the user) when a non-404 fetch failure occurs.
  failureLogLabel: string;
  // Shown to the user in place of the list when a non-404 fetch fails.
  userFacingErrorMessage: string;
}

/**
 * Builds a re-entrant fetcher for one profile sub-resource list at
 * `/api/users/[id]/<resourcePath>`. Re-entrant because the profile route
 * re-runs these fetchers when its `id` param changes: each call carries a
 * monotonic request id so a late response from a superseded call is
 * discarded, and switching to a different profile clears the list immediately
 * (a same-user refresh, e.g. after a follow toggle, keeps it visible instead
 * of flashing back to the loading note).
 */
function createListFetcher<Item, Response>(
  apiFetch: <T>(url: string) => Promise<T>,
  state: ListFetchState<Item>,
  config: ListFetcherConfig<Item, Response>,
): (userId: string) => Promise<void> {
  let requestId = 0;
  let loadedUserId: string | null = null;

  return async function fetchPage(userId: string): Promise<void> {
    const thisRequestId = ++requestId;
    if (userId !== loadedUserId) {
      state.items.value = [];
      state.hasMore.value = false;
      loadedUserId = userId;
    }
    state.loading.value = true;
    state.errorMessage.value = null;

    try {
      const response = await apiFetch<Response>(
        `/api/users/${encodeURIComponent(userId)}/${config.resourcePath}`,
      );
      if (thisRequestId !== requestId) {
        return;
      }
      const page = config.extractPage(response);
      state.items.value = page.items;
      state.hasMore.value = page.hasMore;
    } catch (fetchError) {
      if (thisRequestId !== requestId) {
        return;
      }
      state.items.value = [];
      state.hasMore.value = false;
      // A private/missing profile already surfaces via fetchProfile's
      // notFound, so a 404 here needs no separate error. Any other failure
      // must not be shown to the user as an empty list — surface it loudly.
      if (isNotFound(fetchError)) {
        return;
      }
      console.error(config.failureLogLabel, fetchError);
      state.errorMessage.value = config.userFacingErrorMessage;
    } finally {
      if (thisRequestId === requestId) {
        state.loading.value = false;
      }
    }
  };
}

export function useProfile() {
  const { apiFetch } = useApiClient();

  const profile = ref<ProfileUser | null>(null);
  // Starts true so the first (pre-fetch) render shows the loading state rather
  // than an empty body; fetchProfile flips it false when the request settles.
  const isLoading = ref(true);
  const notFound = ref(false);
  const error = ref<string | null>(null);

  const followersState = createListFetchState<ProfileFollower>();
  const tripsState = createListFetchState<ProfileTrip>();
  const guidesState = createListFetchState<ProfileGuide>();

  let profileRequestId = 0;

  async function fetchProfile(userId: string): Promise<void> {
    const requestId = ++profileRequestId;
    isLoading.value = true;
    notFound.value = false;
    error.value = null;

    try {
      const result = await apiFetch<ProfileUser>(
        `/api/users/${encodeURIComponent(userId)}`,
      );
      if (requestId !== profileRequestId) {
        return;
      }
      profile.value = result;
    } catch (fetchError) {
      if (requestId !== profileRequestId) {
        return;
      }
      profile.value = null;
      if (isNotFound(fetchError)) {
        notFound.value = true;
        return;
      }
      console.error("useProfile: fetchProfile failed", fetchError);
      error.value = "Could not load this profile";
    } finally {
      if (requestId === profileRequestId) {
        isLoading.value = false;
      }
    }
  }

  const fetchFollowers = createListFetcher<
    ProfileFollower,
    { followers: ProfileFollower[]; hasMore: boolean }
  >(apiFetch, followersState, {
    resourcePath: "followers",
    extractPage: (response) => ({
      items: response.followers,
      hasMore: response.hasMore,
    }),
    failureLogLabel: "useProfile: fetchFollowers failed",
    userFacingErrorMessage: "Could not load followers",
  });

  const fetchTrips = createListFetcher<
    ProfileTrip,
    { trips: ProfileTrip[]; hasMore: boolean }
  >(apiFetch, tripsState, {
    resourcePath: "trips",
    extractPage: (response) => ({
      items: response.trips,
      hasMore: response.hasMore,
    }),
    failureLogLabel: "useProfile: fetchTrips failed",
    userFacingErrorMessage: "Could not load trips",
  });

  const fetchGuides = createListFetcher<
    ProfileGuide,
    { guides: ProfileGuide[]; hasMore: boolean }
  >(apiFetch, guidesState, {
    resourcePath: "guides",
    extractPage: (response) => ({
      items: response.guides,
      hasMore: response.hasMore,
    }),
    failureLogLabel: "useProfile: fetchGuides failed",
    userFacingErrorMessage: "Could not load guides",
  });

  return {
    profile,
    followers: followersState.items,
    hasMoreFollowers: followersState.hasMore,
    trips: tripsState.items,
    hasMoreTrips: tripsState.hasMore,
    guides: guidesState.items,
    hasMoreGuides: guidesState.hasMore,
    isLoading,
    followersLoading: followersState.loading,
    tripsLoading: tripsState.loading,
    guidesLoading: guidesState.loading,
    notFound,
    error,
    followersError: followersState.errorMessage,
    tripsError: tripsState.errorMessage,
    guidesError: guidesState.errorMessage,
    fetchProfile,
    fetchFollowers,
    fetchTrips,
    fetchGuides,
  };
}
