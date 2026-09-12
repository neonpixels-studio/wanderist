<template>
  <NuxtLink class="person" :to="`/u/${encodeURIComponent(person.userId)}`">
    <span class="person__av">
      <AppIcon name="user" :size="19" />
    </span>
    <div class="person__name">
      <b>{{ displayName }}</b>
      <span v-if="person.handle">{{ formatHandle(person.handle) }}</span>
    </div>
  </NuxtLink>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ProfileFollower } from "~/composables/useProfile";
import { DEFAULT_TRAVELER_NAME, formatHandle } from "~/utils/travelerLabels";

// The shared avatar+name row for a follower/followee list entry
// (ProfileFollowerList, ProfileFollowingList): both are a list of the same
// `ProfileFollower` shape linked to `/u/[id]`, so the row itself — including
// the display-name fallback — lives once here instead of being duplicated
// per list. Reuses `ProfileFollower` rather than re-declaring the shape so
// the two can't silently drift apart.
const props = defineProps<{ person: ProfileFollower }>();

const displayName = computed(
  () =>
    props.person.displayName ?? props.person.handle ?? DEFAULT_TRAVELER_NAME,
);
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
.person__name {
  /* Let the name column shrink inside the flex row instead of overflowing
     the card when displayName/handle is long. */
  flex: 1;
  min-width: 0;
}
.person__name b {
  font-size: 13px;
}
/* Scoped to the whole row (not just the name block) since the entire
   NuxtLink — including the avatar and its padding — is the click target. */
.person:hover .person__name b {
  color: var(--accent-ink);
}
.person__name span {
  font-size: 11px;
  color: var(--muted);
  display: block;
}
</style>
