<template>
  <!-- Not dismissible: this is the section's only content when it errors, so
       dismissing it would leave the section blank with no way to recover. -->
  <AppAlert v-if="errorMessage" intent="error" :message="errorMessage" />
  <!-- Only show the loading note when there is nothing yet; a refresh (e.g.
       after a follow toggle) keeps the existing list visible rather than
       flashing back to this line. -->
  <p v-else-if="loading && !following.length" class="empty-note">
    Loading following…
  </p>
  <div v-else-if="following.length" class="card card--pad">
    <ProfilePersonRow
      v-for="followee in following"
      :key="followee.userId"
      :person="followee"
    />
    <p v-if="hasMore" class="following-more">
      Showing the {{ following.length }} most recently followed travelers.
    </p>
  </div>
  <p v-else class="empty-note">Not following anyone publicly yet.</p>
</template>

<script setup lang="ts">
import ProfilePersonRow from "~/components/ProfilePersonRow.vue";
import type { ProfileFollowee } from "~/composables/useProfile";

withDefaults(
  defineProps<{
    following: ProfileFollowee[];
    loading?: boolean;
    errorMessage?: string | null;
    hasMore?: boolean;
  }>(),
  { loading: false, errorMessage: null, hasMore: false },
);
</script>

<style scoped>
.empty-note {
  font-size: 12.5px;
  color: var(--faint);
  padding: 12px 0;
}

.following-more {
  font-size: 11.5px;
  color: var(--faint);
  padding: 12px 2px 2px;
  text-align: center;
}
</style>
