<template>
  <header class="phead card card--pad">
    <span class="phead__av">
      <AppIcon name="user" :size="30" />
    </span>
    <div class="phead__id">
      <h1>{{ displayName }}</h1>
      <div v-if="handleLabel" class="phead__handle">{{ handleLabel }}</div>
      <div v-if="homeBase" class="phead__home">
        <AppIcon name="pin" :size="13" />
        {{ homeBase }}
      </div>
    </div>
    <button
      v-if="!isSelf && viewerIsSignedIn"
      class="btn btn--sm"
      :class="following ? 'btn--primary' : 'btn--outline'"
      :disabled="pending"
      @click="$emit('toggle')"
    >
      <template v-if="following">
        <AppIcon name="check" :size="14" />
        following
      </template>
      <template v-else>follow</template>
    </button>
    <NuxtLink
      v-else-if="!isSelf && viewerAuthLoaded"
      to="/login"
      class="btn btn--outline btn--sm"
    >
      sign in to follow
    </NuxtLink>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  displayName: string;
  handleLabel: string;
  homeBase: string | null;
  isSelf: boolean;
  following: boolean;
  pending: boolean;
  // Both derived from Clerk: an anonymous visitor (a shared profile link is
  // openable without auth, see #279) can view the profile but not follow it.
  // viewerAuthLoaded (isClerkLoaded, passed straight through) gates the
  // prompt so it doesn't flash for a viewer who turns out to be signed in a
  // moment later — matches trips/[id].vue and guides/[id].vue's identical
  // isClerkLoaded && !isSignedIn pattern. A viewer whose Clerk script never
  // resolves at all (ad blocker, flaky CDN) sees neither affordance here,
  // the same accepted limitation those sibling pages have.
  viewerIsSignedIn: boolean;
  viewerAuthLoaded: boolean;
}>();

defineEmits<{ toggle: [] }>();
</script>

<style scoped>
.phead {
  display: flex;
  align-items: center;
  gap: 16px;
}
.phead__av {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg);
  background: var(--accent-weak);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  flex: none;
}
.phead__id {
  flex: 1;
}
.phead__id h1 {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
}
.phead__handle {
  font-size: 13px;
  color: var(--muted);
  margin-top: 2px;
}
.phead__home {
  font-size: 12px;
  color: var(--faint);
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
</style>
