<template>
  <div class="gcard">
    <div class="gcard__body">
      <NuxtLink :to="`/guides/${guide.id}`" class="gcard__name">
        {{ guide.title }}
      </NuxtLink>
      <div class="gcard__meta">
        <span class="m">
          <AppIcon name="clock" :size="12" />
          {{ guide.readTimeMinutes }} min read
        </span>
        <button
          type="button"
          class="gcard__like"
          :class="{ liked: isLiked }"
          :aria-label="isLiked ? 'Unlike guide' : 'Like guide'"
          @click="emit('toggle-like', guide)"
        >
          <AppIcon name="heart" :size="12" />
          {{ guide.likeCount }}
        </button>
        <span class="tag" :class="visibilityTagClass">
          {{ guide.visibility }}
        </span>
      </div>
    </div>
    <div class="gcard__acts">
      <template v-if="confirmingDelete">
        <button
          class="btn btn--sm gcard__delete-confirm"
          :disabled="deleting"
          @click="emit('delete', guide)"
        >
          {{ deleting ? "deleting…" : "confirm delete" }}
        </button>
        <button
          class="btn btn--outline btn--sm"
          :disabled="deleting"
          @click="confirmingDelete = false"
        >
          cancel
        </button>
      </template>
      <template v-else>
        <button class="btn btn--outline btn--sm" @click="emit('edit', guide)">
          edit
        </button>
        <button
          class="btn btn--outline btn--sm"
          @click="confirmingDelete = true"
        >
          delete
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { Guide } from "~/stores/guides";

const VISIBILITY_TAG_CLASS: Record<Guide["visibility"], string> = {
  public: "tag--ongoing",
  private: "tag--past",
};

const props = defineProps<{
  guide: Guide;
  deleting?: boolean;
  isLiked?: boolean;
}>();

const emit = defineEmits<{
  edit: [guide: Guide];
  delete: [guide: Guide];
  "toggle-like": [guide: Guide];
}>();

// Stays true across a failed delete so a retry is one click away — the
// page-level error banner (see guides/index.vue) explains the failure.
const confirmingDelete = ref(false);
const visibilityTagClass = computed(
  () => VISIBILITY_TAG_CLASS[props.guide.visibility],
);
</script>

<style scoped>
.gcard {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.gcard__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gcard__name {
  font-family: var(--font-display);
  font-size: 14.5px;
  font-weight: 600;
  color: inherit;
  text-decoration: none;
  /* Without this the link, as a flex item of the column body, stretches to the
     full card width and its hover/click area spills far past the title. */
  align-self: flex-start;
}
.gcard__name:hover {
  color: var(--accent-ink);
}
.gcard__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--faint);
  margin-top: 6px;
}
.gcard__meta .m {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.gcard__like {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--faint);
  cursor: pointer;
}
.gcard__like:not(.liked):hover {
  color: var(--accent-ink);
}
/* --error-ink (not --error) so the liked heart keeps AA contrast in the dark
   theme, where only --error-ink is redefined — see app/assets/css/main.css. */
.gcard__like.liked {
  color: var(--error-ink);
}
.gcard__acts {
  display: flex;
  gap: 8px;
  flex: none;
}
/* Matches the destructive-action styling in app/pages/settings.vue's danger
   zone (delete account); no shared `.btn--danger` class exists yet in the
   design system to reuse instead of repeating the two literal colors. */
.gcard__delete-confirm {
  background: var(--error);
  color: #fff;
}
</style>
