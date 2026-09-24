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
import { computed } from "vue";
import { DEFAULT_TRAVELER_NAME, formatHandle } from "~/utils/travelerLabels";
import { useClerkGatedFetch } from "~/composables/useClerkGatedFetch";
import { SITE_NAME, useOgMeta } from "~/composables/useOgMeta";

const openCommandPalette = inject<(() => void) | undefined>(
  "openCommandPalette",
  undefined,
);

definePageMeta({ layout: "app", middleware: "auth" });

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

// This page requires auth (middleware: "auth" above), but that middleware
// itself doesn't wait for Clerk to finish loading — it only redirects once
// isLoaded is already true, so an unresolved Clerk on a hard refresh still
// lets the page mount. apiFetch (see useApiClient) then sends the profile
// request with no token, which the server treats as anonymous and rejects
// with a 401 (#280, the same race #255 fixed for guide/trip detail) — even
// for a viewer loading their own profile.
const { isLoaded: isClerkLoaded, isSignedIn } = useClerkAuth();

// A refetch only changes the answer once the viewer is signed in; an
// anonymous visitor never gains a token, so this (turned into
// retryGeneration by useClerkGatedFetch below) never advances a second time
// for them.
const canRetryAuthenticated = computed(
  () => isClerkLoaded.value && !!isSignedIn.value,
);

// Gated on Clerk's bootstrap (#255, #280) so the viewer's first request
// already carries a token instead of 401ing anonymously first — see
// useClerkGatedFetch.
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
// `server: false` keeps the fetch client-only: these calls carry the Clerk
// session token (client-side), so running them during SSR would 401 and
// hydrate a stuck loading state. This mirrors explore.vue's client-only load
// while keeping trips/[id].vue's watch-on-param refetch.
//
// fetchFollowing (the viewer's own follow state) is bundled in here rather
// than a separate onMounted call: it carries the same token and would race
// Clerk's bootstrap the same way, and useClerkGatedFetch only supports one
// in-flight gate per call site (a second concurrent gate() call tears down
// the first's pending timer/watch) — so both fetches must share this single
// gate. The minor cost is refetching the viewer's own follow state on every
// profile navigation, not just on mount.
function fetchProfileDetail(): Promise<unknown> {
  return gateOnClerkLoad(() =>
    Promise.all([
      fetchProfile(userId.value),
      fetchFollowers(userId.value),
      fetchFollowingList(userId.value),
      fetchTrips(userId.value),
      fetchGuides(userId.value),
      fetchFollowing(),
    ]),
  );
}

useAsyncData(() => `profile-${userId.value}`, fetchProfileDetail, {
  server: false,
  watch: [userId, retryGeneration],
});
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
