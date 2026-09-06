<template>
  <!-- Not dismissible: this is the section's only content when it errors, so
       dismissing it would leave the section blank with no way to recover. -->
  <AppAlert v-if="errorMessage" intent="error" :message="errorMessage" />
  <!-- Only show the loading note when there is nothing yet; a refresh keeps
       the existing list visible rather than flashing back to this line. -->
  <p v-else-if="loading && !guides.length" class="empty-note">
    Loading guides…
  </p>
  <div v-else-if="guides.length" class="card card--pad">
    <NuxtLink
      v-for="guide in guides"
      :key="guide.id"
      class="guide"
      :to="`/guides/${encodeURIComponent(guide.id)}`"
    >
      <span class="guide__av">
        <AppIcon name="journal" :size="18" />
      </span>
      <div class="guide__body">
        <b>{{ guide.title }}</b>
        <span>{{ guide.readTimeMinutes }} min read</span>
      </div>
      <span class="guide__likes">
        <AppIcon name="heart" :size="12" />
        {{ guide.likeCount }}
      </span>
    </NuxtLink>
    <p v-if="hasMore" class="guides-more">
      Showing the {{ guides.length }} most recent public guides.
    </p>
  </div>
  <p v-else class="empty-note">No public guides yet.</p>
</template>

<script setup lang="ts">
import type { ProfileGuide } from "~/composables/useProfile";

withDefaults(
  defineProps<{
    guides: ProfileGuide[];
    loading?: boolean;
    errorMessage?: string | null;
    hasMore?: boolean;
  }>(),
  { loading: false, errorMessage: null, hasMore: false },
);
</script>

<style scoped>
.guide {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--line);
  text-decoration: none;
  color: inherit;
}
.guide:last-child {
  border-bottom: none;
}
.guide__av {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--accent-weak);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  flex: none;
}
.guide__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.guide__body b {
  font-size: 13px;
}
.guide:hover .guide__body b {
  color: var(--accent-ink);
}
.guide__body span {
  font-size: 11px;
  color: var(--muted);
  display: block;
}
.guide__likes {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--faint);
  flex: none;
}

.empty-note {
  font-size: 12.5px;
  color: var(--faint);
  padding: 12px 0;
}

.guides-more {
  font-size: 11.5px;
  color: var(--faint);
  padding: 12px 2px 2px;
  text-align: center;
}
</style>
