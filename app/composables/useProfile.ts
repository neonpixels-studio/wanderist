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
 * All fetchers are re-entrant (the profile route re-runs them when its `id`
 * param changes) so each call carries a monotonic request id and a late
 * response from a superseded call is discarded — a slow first profile can never
 * overwrite a faster second one.
 */

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
  status: string;
  startDate: string | null;
  endDate: string | null;
  distanceKm: number | null;
  stopCount: number;
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

export function useProfile() {
  const { apiFetch } = useApiClient();

  const profile = ref<ProfileUser | null>(null);
  const followers = ref<ProfileFollower[]>([]);
  const hasMoreFollowers = ref(false);
  const trips = ref<ProfileTrip[]>([]);
  const hasMoreTrips = ref(false);
  const guides = ref<ProfileGuide[]>([]);
  const hasMoreGuides = ref(false);
  // Starts true so the first (pre-fetch) render shows the loading state rather
  // than an empty body; fetchProfile flips it false when the request settles.
  const isLoading = ref(true);
  const followersLoading = ref(true);
  const tripsLoading = ref(true);
  const guidesLoading = ref(true);
  const notFound = ref(false);
  const error = ref<string | null>(null);
  const followersError = ref<string | null>(null);
  const tripsError = ref<string | null>(null);
  const guidesError = ref<string | null>(null);

  // Monotonic request ids; a resolved response is applied only if it is still
  // the latest call, so out-of-order responses from rapid param changes are
  // discarded.
  let profileRequestId = 0;
  let followersRequestId = 0;
  let tripsRequestId = 0;
  let guidesRequestId = 0;

  // The user whose followers/trips/guides are currently loaded, so a switch to
  // a different profile can clear the stale list up front while a same-user
  // refresh keeps it visible.
  let loadedFollowersUserId: string | null = null;
  let loadedTripsUserId: string | null = null;
  let loadedGuidesUserId: string | null = null;

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

  async function fetchFollowers(userId: string): Promise<void> {
    const requestId = ++followersRequestId;
    // Switching to a different profile: drop the previous traveler's followers
    // immediately so the list can't render under the new name while the new
    // fetch is in flight. A same-user refresh (e.g. after a follow toggle)
    // keeps the list visible to avoid flashing back to the loading note.
    if (userId !== loadedFollowersUserId) {
      followers.value = [];
      hasMoreFollowers.value = false;
      loadedFollowersUserId = userId;
    }
    followersLoading.value = true;
    followersError.value = null;

    try {
      const response = await apiFetch<{
        followers: ProfileFollower[];
        hasMore: boolean;
      }>(`/api/users/${encodeURIComponent(userId)}/followers`);
      if (requestId !== followersRequestId) {
        return;
      }
      followers.value = response.followers;
      hasMoreFollowers.value = response.hasMore;
    } catch (fetchError) {
      if (requestId !== followersRequestId) {
        return;
      }
      followers.value = [];
      hasMoreFollowers.value = false;
      // A private/missing profile already surfaces via fetchProfile's notFound,
      // so a 404 here needs no separate error. Any other failure must not be
      // shown to the user as "no followers" — surface it loudly instead.
      if (isNotFound(fetchError)) {
        return;
      }
      console.error("useProfile: fetchFollowers failed", fetchError);
      followersError.value = "Could not load followers";
    } finally {
      if (requestId === followersRequestId) {
        followersLoading.value = false;
      }
    }
  }

  async function fetchTrips(userId: string): Promise<void> {
    const requestId = ++tripsRequestId;
    // Switching to a different profile: drop the previous traveler's trips
    // immediately so the list can't render under the new name while the new
    // fetch is in flight. A same-user refresh keeps the list visible to avoid
    // flashing back to the loading note.
    if (userId !== loadedTripsUserId) {
      trips.value = [];
      hasMoreTrips.value = false;
      loadedTripsUserId = userId;
    }
    tripsLoading.value = true;
    tripsError.value = null;

    try {
      const response = await apiFetch<{
        trips: ProfileTrip[];
        hasMore: boolean;
      }>(`/api/users/${encodeURIComponent(userId)}/trips`);
      if (requestId !== tripsRequestId) {
        return;
      }
      trips.value = response.trips;
      hasMoreTrips.value = response.hasMore;
    } catch (fetchError) {
      if (requestId !== tripsRequestId) {
        return;
      }
      trips.value = [];
      hasMoreTrips.value = false;
      // A private/missing profile already surfaces via fetchProfile's notFound,
      // so a 404 here needs no separate error. Any other failure must not be
      // shown to the user as "no trips" — surface it loudly instead.
      if (isNotFound(fetchError)) {
        return;
      }
      console.error("useProfile: fetchTrips failed", fetchError);
      tripsError.value = "Could not load trips";
    } finally {
      if (requestId === tripsRequestId) {
        tripsLoading.value = false;
      }
    }
  }

  async function fetchGuides(userId: string): Promise<void> {
    const requestId = ++guidesRequestId;
    // Switching to a different profile: drop the previous traveler's guides
    // immediately so the list can't render under the new name while the new
    // fetch is in flight. A same-user refresh keeps the list visible to avoid
    // flashing back to the loading note.
    if (userId !== loadedGuidesUserId) {
      guides.value = [];
      hasMoreGuides.value = false;
      loadedGuidesUserId = userId;
    }
    guidesLoading.value = true;
    guidesError.value = null;

    try {
      const response = await apiFetch<{
        guides: ProfileGuide[];
        hasMore: boolean;
      }>(`/api/users/${encodeURIComponent(userId)}/guides`);
      if (requestId !== guidesRequestId) {
        return;
      }
      guides.value = response.guides;
      hasMoreGuides.value = response.hasMore;
    } catch (fetchError) {
      if (requestId !== guidesRequestId) {
        return;
      }
      guides.value = [];
      hasMoreGuides.value = false;
      // A private/missing profile already surfaces via fetchProfile's notFound,
      // so a 404 here needs no separate error. Any other failure must not be
      // shown to the user as "no guides" — surface it loudly instead.
      if (isNotFound(fetchError)) {
        return;
      }
      console.error("useProfile: fetchGuides failed", fetchError);
      guidesError.value = "Could not load guides";
    } finally {
      if (requestId === guidesRequestId) {
        guidesLoading.value = false;
      }
    }
  }

  return {
    profile,
    followers,
    hasMoreFollowers,
    trips,
    hasMoreTrips,
    guides,
    hasMoreGuides,
    isLoading,
    followersLoading,
    tripsLoading,
    guidesLoading,
    notFound,
    error,
    followersError,
    tripsError,
    guidesError,
    fetchProfile,
    fetchFollowers,
    fetchTrips,
    fetchGuides,
  };
}
