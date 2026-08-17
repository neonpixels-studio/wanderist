<template>
  <button
    v-if="hasMore"
    type="button"
    class="load-more"
    :disabled="loading"
    @click="$emit('load')"
  >
    {{ label }}
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{ hasMore: boolean; loading: boolean }>();
defineEmits<{ load: [] }>();

const label = computed(() => (props.loading ? "Loading…" : "Load more"));
</script>

<style scoped>
.load-more {
  display: block;
  margin: 16px auto 0;
  padding: 10px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}

.load-more:hover:not(:disabled) {
  background: var(--surface-2);
}

.load-more:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
