/**
 * useProfile — fetches a public user profile and its followers list.
 *
 * - profile: the loaded profile (null until fetched, or when not viewable)
 * - followers: the profile's public followers
 * - notFound: true when the profile does not exist or is private to the viewer
 * - fetchProfile / fetchFollowers: load each part for a given user ID
 *
 * The backend returns 404 both for a missing user and for a private profile the
 * viewer may not see, so the composable cannot (and should not) distinguish
 * them — both surface as `notFound`.
 *
 * Both fetchers are re-entrant (the profile route re-runs them when its `id`
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
  // Starts true so the first (pre-fetch) render shows the loading state rather
  // than an empty body; fetchProfile flips it false when the request settles.
  const isLoading = ref(true);
  const followersLoading = ref(true);
  const notFound = ref(false);
  const error = ref<string | null>(null);
  const followersError = ref<string | null>(null);

  // Monotonic request ids; a resolved response is applied only if it is still
  // the latest call, so out-of-order responses from rapid param changes are
  // discarded.
  let profileRequestId = 0;
  let followersRequestId = 0;

  // The user whose followers are currently loaded, so a switch to a different
  // profile can clear the stale list up front while a same-user refresh keeps
  // it visible.
  let loadedFollowersUserId: string | null = null;

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

  return {
    profile,
    followers,
    hasMoreFollowers,
    isLoading,
    followersLoading,
    notFound,
    error,
    followersError,
    fetchProfile,
    fetchFollowers,
  };
}
