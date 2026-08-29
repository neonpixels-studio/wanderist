<template>
  <div class="field">
    <label class="field__label">Location</label>
    <div class="field__wrap">
      <input
        :value="modelValue"
        class="field__input"
        data-test="location-input"
        @input="onInput"
      />
      <span class="field__icon"><AppIcon name="pin" :size="16" /></span>
    </div>
    <div v-if="suggestions.length" class="chip-suggest">
      <span
        v-for="place in suggestions"
        :key="place.id"
        class="chip"
        @click="emit('select', place)"
        >{{ place.name }}</span
      >
    </div>
    <div v-if="canCreatePlace" class="location-create">
      <span class="location-create__hint"
        >No saved place matches this location.</span
      >
      <button
        class="btn btn--outline btn--sm location-create__btn"
        :disabled="isCreatingPlace"
        @click="emit('create')"
      >
        <AppIcon name="plus" :size="12" />
        {{ isCreatingPlace ? "creating…" : `Create “${canonicalLocation}”` }}
      </button>
    </div>
    <p v-if="createPlaceError" class="error-hint location-create__error">
      {{ createPlaceError }}
    </p>
    <p v-if="placesLoadFailed" class="error-hint places-load__error">
      Couldn't load your saved places, so suggestions and inline creation are
      unavailable. Your typed location is still saved when you publish.
    </p>
  </div>
</template>

<script setup lang="ts">
interface PlaceSuggestion {
  id: string;
  name: string;
}

defineProps<{
  modelValue: string;
  suggestions: PlaceSuggestion[];
  canCreatePlace: boolean;
  isCreatingPlace: boolean;
  createPlaceError: string | null;
  placesLoadFailed: boolean;
  canonicalLocation: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  select: [place: PlaceSuggestion];
  create: [];
}>();

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>
