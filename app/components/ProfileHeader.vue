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
      v-if="!isSelf"
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
