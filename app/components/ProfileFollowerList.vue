<template>
  <!-- Not dismissible: this is the section's only content when it errors, so
       dismissing it would leave the section blank with no way to recover. -->
  <AppAlert v-if="errorMessage" intent="error" :message="errorMessage" />
  <!-- Only show the loading note when there is nothing yet; a refresh (e.g.
       after a follow toggle) keeps the existing list visible rather than
       flashing back to this line. -->
  <p v-else-if="loading && !followers.length" class="empty-note">
    Loading followers…
  </p>
  <div v-else-if="followers.length" class="card card--pad">
    <NuxtLink
      v-for="follower in followers"
      :key="follower.userId"
      class="person"
      :to="`/u/${encodeURIComponent(follower.userId)}`"
    >
      <span class="person__av">
        <AppIcon name="user" :size="19" />
      </span>
      <div class="person__name">
        <b>{{ followerDisplayName(follower) }}</b>
        <span v-if="follower.handle">{{ formatHandle(follower.handle) }}</span>
      </div>
    </NuxtLink>
    <p v-if="hasMore" class="followers-more">
      Showing the {{ followers.length }} most recent followers.
    </p>
  </div>
  <p v-else class="empty-note">No public followers yet.</p>
</template>

<script setup lang="ts">
import type { ProfileFollower } from "~/composables/useProfile";
import { DEFAULT_TRAVELER_NAME, formatHandle } from "~/utils/travelerLabels";

withDefaults(
  defineProps<{
    followers: ProfileFollower[];
    loading?: boolean;
    errorMessage?: string | null;
    hasMore?: boolean;
  }>(),
  { loading: false, errorMessage: null, hasMore: false },
);

function followerDisplayName(follower: ProfileFollower): string {
  return follower.displayName ?? follower.handle ?? DEFAULT_TRAVELER_NAME;
}
</script>

<style scoped>
.person {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--line);
  text-decoration: none;
  color: inherit;
}
.person:last-child {
  border-bottom: none;
}
.person__av {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--accent-weak);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  flex: none;
}
.person__name b {
  font-size: 13px;
}
.person__name:hover b {
  color: var(--accent-ink);
}
.person__name span {
  font-size: 11px;
  color: var(--muted);
  display: block;
}

.empty-note {
  font-size: 12.5px;
  color: var(--faint);
  padding: 12px 0;
}

.followers-more {
  font-size: 11.5px;
  color: var(--faint);
  padding: 12px 2px 2px;
  text-align: center;
}
</style>
