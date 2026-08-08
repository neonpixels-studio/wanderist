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
        :following="following"
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { DEFAULT_TRAVELER_NAME, formatHandle } from "~/utils/travelerLabels";

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
  isLoading,
  followersLoading,
  notFound,
  error,
  followersError,
  fetchProfile,
  fetchFollowers,
} = useProfile();

const {
  fetchFollowing,
  toggleFollow,
  isFollowing,
  isPending,
  error: followError,
} = useFollows();

const displayName = computed(
  () =>
    profile.value?.displayName ??
    profile.value?.handle ??
    DEFAULT_TRAVELER_NAME,
);

const handleLabel = computed(() => formatHandle(profile.value?.handle));

const following = computed(() => isFollowing(userId.value));
const pending = computed(() => isPending(userId.value));

useHead(
  computed(() => ({
    title: profile.value
      ? `Wanderist — ${displayName.value}`
      : "Wanderist — Profile",
  })),
);

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
useAsyncData(
  () => `profile-${userId.value}`,
  () => Promise.all([fetchProfile(userId.value), fetchFollowers(userId.value)]),
  { server: false, watch: [userId] },
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
