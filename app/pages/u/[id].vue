<template>
  <div class="content">
    <AppTopbar title="Profile" crumb="Travelers">
      <button
        class="icon-btn"
        aria-label="Search"
        @click="openCommandPalette?.()"
      >
        <AppIcon name="search" :size="18" />
      </button>
    </AppTopbar>

    <div v-if="isLoading" class="profile-state" aria-busy="true">
      Loading profile…
    </div>

    <div v-else-if="notFound" class="profile-state">
      <h2>Profile unavailable</h2>
      <p>This traveler doesn’t exist or keeps their profile private.</p>
      <NuxtLink class="btn btn--outline btn--sm" to="/explore">
        <AppIcon name="arrow-right" :size="14" />
        back to Explore
      </NuxtLink>
    </div>

    <AppAlert v-else-if="error" intent="error" :message="error" />

    <template v-else-if="profile">
      <ProfileHeader
        :display-name="displayName"
        :handle-label="handleLabel"
        :home-base="profile.homeBase"
        :is-self="profile.isSelf"
        :following="viewerIsFollowingTarget"
        :pending="pending"
        :viewer-is-signed-in="!!isSignedIn"
        :viewer-auth-resolved="isClerkLoaded"
        @toggle="onToggleFollow"
      />

      <AppAlert
        v-if="followError"
        intent="error"
        :message="followError"
        :dismissible="true"
      />

      <p v-if="profile.bio" class="pbio">{{ profile.bio }}</p>

      <div class="pstats">
        <div class="pstat">
          <b>{{ profile.followerCount }}</b>
          <span>followers</span>
        </div>
        <div class="pstat">
          <b>{{ profile.followingCount }}</b>
          <span>following</span>
        </div>
        <div class="pstat">
          <b>{{ profile.placeCount }}</b>
          <span>places</span>
        </div>
      </div>

      <section class="psec">
        <div class="sec-head">
          <div>
            <div class="label">// followers</div>
            <h2>Who follows {{ displayName }}</h2>
          </div>
        </div>
        <ProfileFollowerList
          :followers="followers"
          :loading="followersLoading"
          :error-message="followersError"
          :has-more="hasMoreFollowers"
        />
      </section>

      <section class="psec">
        <div class="sec-head">
          <div>
            <div class="label">// following</div>
            <h2>Who {{ displayName }} follows</h2>
          </div>
        </div>
        <ProfileFollowingList
          :following="following"
          :loading="followingLoading"
          :error-message="followingError"
          :has-more="hasMoreFollowing"
        />
      </section>

      <section class="psec">
        <div class="sec-head">
          <div>
            <div class="label">// trips</div>
            <h2>{{ displayName }}’s public trips</h2>
          </div>
        </div>
        <ProfileTripList
          :trips="trips"
          :loading="tripsLoading"
          :error-message="tripsError"
          :has-more="hasMoreTrips"
        />
      </section>

      <section class="psec">
        <div class="sec-head">
          <div>
            <div class="label">// guides</div>
            <h2>{{ displayName }}’s public guides</h2>
          </div>
        </div>
        <ProfileGuideList
          :guides="guides"
          :loading="guidesLoading"
          :error-message="guidesError"
          :has-more="hasMoreGuides"
        />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { DEFAULT_TRAVELER_NAME, formatHandle } from "~/utils/travelerLabels";
import { SITE_NAME, useOgMeta } from "~/composables/useOgMeta";
import { useClerkGatedFetch } from "~/composables/useClerkGatedFetch";

const openCommandPalette = inject<(() => void) | undefined>(
  "openCommandPalette",
  undefined,
);

// No auth middleware: a public profile must open for anonymous visitors
// following a shared link, so its og/twitter meta (see useOgMeta below) can
// unfurl in Slack/iMessage/etc previews (#279). This mirrors trips/[id].vue
// and guides/[id].vue. The GET endpoints (/api/users/[id] and its
// followers/following/trips/guides sub-resources) enforce visibility — a
// private profile 404s for anyone but its owner, it never redirects to
// /login — so a private profile stays protected. Owner-only affordances
// (follow/unfollow) are meaningless for the profile owner viewing their own
// page and simply reflect `profile.isSelf` from the API response.
definePageMeta({ layout: "app" });

const route = useRoute();
const userId = computed(() => String(route.params.id));

const {
  profile,
  followers,
  hasMoreFollowers,
  following,
  hasMoreFollowing,
  trips,
  hasMoreTrips,
  guides,
  hasMoreGuides,
  isLoading,
  followersLoading,
  followingLoading,
  tripsLoading,
  guidesLoading,
  notFound,
  error,
  followersError,
  followingError,
  tripsError,
  guidesError,
  fetchProfile,
  fetchFollowers,
  fetchFollowingList,
  fetchTrips,
  fetchGuides,
} = useProfile();

const {
  fetchFollowing,
  toggleFollow,
  isFollowing,
  isPending,
  error: followError,
} = useFollows();

// isLoaded gates when the profile fetch below is allowed to fire with a real
// token (see the useClerkGatedFetch usage further down); isSignedIn drives
// canRetryAuthenticated so a session that resolves after the first (possibly
// anonymous) fetch re-issues it, same as trips/[id].vue and guides/[id].vue.
const { isLoaded: isClerkLoaded, isSignedIn } = useClerkAuth();
const canRetryAuthenticated = computed(
  () => isClerkLoaded.value && !!isSignedIn.value,
);
const { gate: gateOnClerkLoad, retryGeneration } = useClerkGatedFetch(
  isClerkLoaded,
  canRetryAuthenticated,
);

const displayName = computed(
  () =>
    profile.value?.displayName ??
    profile.value?.handle ??
    DEFAULT_TRAVELER_NAME,
);

const handleLabel = computed(() => formatHandle(profile.value?.handle));

// Whether the viewer (not the profile owner) follows this profile — distinct
// from `following`, the profile owner's own list of who they follow.
const viewerIsFollowingTarget = computed(() => isFollowing(userId.value));
const pending = computed(() => isPending(userId.value));

// Falls back to a stats summary when the traveler hasn't written a bio (or
// the bio is only whitespace), so a share-link preview never shows a blank
// description.
const profileDescription = computed(() => {
  if (!profile.value) {
    return `A traveler's profile on ${SITE_NAME}.`;
  }
  if (profile.value.bio?.trim()) {
    return profile.value.bio;
  }
  const followerLabel = `${profile.value.followerCount} ${profile.value.followerCount === 1 ? "follower" : "followers"}`;
  const placeLabel = `${profile.value.placeCount} ${profile.value.placeCount === 1 ? "place" : "places"}`;
  return `${displayName.value} on ${SITE_NAME} — ${followerLabel}, ${placeLabel}.`;
});

useOgMeta(() => ({
  pageTitle: profile.value ? displayName.value : "Profile",
  description: profileDescription.value,
}));

async function onToggleFollow(): Promise<void> {
  // Capture the target once: the viewer can navigate to another profile while
  // the toggle is in flight (follower rows link to /u/[id]), so re-reading
  // userId after the await would adjust the wrong profile's count.
  const targetUserId = userId.value;
  const wasFollowing = isFollowing(targetUserId);
  await toggleFollow(targetUserId);
  // Bail if the viewer navigated away mid-toggle. profile.value can still hold
  // the previous traveler (fetchProfile doesn't clear it until the new request
  // resolves), so check the live route param too — not just the loaded profile.
  if (userId.value !== targetUserId || profile.value?.userId !== targetUserId) {
    return;
  }
  // Keep the displayed follower count in step with the button after a
  // successful toggle (isFollowing reflects the committed state).
  const nowFollowing = isFollowing(targetUserId);
  if (nowFollowing === wasFollowing) {
    return;
  }
  profile.value.followerCount += nowFollowing ? 1 : -1;
  // The viewer just joined/left this profile's followers, so the list below is
  // now stale — refetch it to keep the list consistent with the count.
  await fetchFollowers(targetUserId);
}

// Drive loading from the route param (not a bare onMounted) so navigating
// between two profiles — the primary path, since follower lists link to
// /u/[id] — refetches instead of showing the previous traveler.
// `server: false` keeps the fetch client-only: an authenticated request
// carries the Clerk session token, which only exists on the client (Clerk
// runs with skipServerMiddleware) — running it during SSR would hang, since
// Clerk's getToken never resolves on the server. This mirrors trips/[id].vue
// and guides/[id].vue.
//
// Gated on Clerk's bootstrap (#255) so the profile owner's first request
// already carries a token instead of reading their own private profile
// anonymously (and 404ing) first — see useClerkGatedFetch. An anonymous
// visitor following a shared link is unaffected: the gate falls back to an
// anonymous fetch after CLERK_BOOTSTRAP_TIMEOUT_MS even if Clerk's script
// never resolves, so a public profile still opens for them.
//
// Watch retryGeneration as well as the id: a signed-in viewer's session
// resolving after the fetch above already fired re-issues the request with a
// token so the owner gets their private profile; signing out re-issues it
// anonymously so a private profile clears from the screen.
useAsyncData(
  () => `profile-${userId.value}`,
  () =>
    gateOnClerkLoad(() =>
      Promise.all([
        fetchProfile(userId.value),
        fetchFollowers(userId.value),
        fetchFollowingList(userId.value),
        fetchTrips(userId.value),
        fetchGuides(userId.value),
      ]),
    ),
  { server: false, watch: [userId, retryGeneration] },
);

// Follow state depends on the session token, so it is client-only too.
onMounted(fetchFollowing);
</script>

<style scoped>
.profile-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--ink-2);
}
.profile-state h2 {
  font-family: var(--font-display);
  font-size: 20px;
  margin-bottom: 8px;
}
.profile-state p {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 18px;
}

.pbio {
  font-size: 13.5px;
  color: var(--ink-2);
  margin: 16px 2px 0;
  line-height: 1.5;
}

.pstats {
  display: flex;
  gap: 26px;
  margin: 18px 2px 8px;
}
.pstat b {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
}
.pstat span {
  font-size: 11px;
  color: var(--muted);
  margin-left: 5px;
}

.psec {
  margin-top: 26px;
}
.sec-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin: 0 0 14px;
}
.sec-head h2 {
  font-family: var(--font-display);
  font-size: 18px;
}
.sec-head .label {
  margin-bottom: 6px;
}
</style>
