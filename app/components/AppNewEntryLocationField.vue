<template>
  <div class="field">
    <label class="field__label">Location</label>
    <div class="field__wrap">
      <input
        v-model="location"
        class="field__input"
        data-test="location-input"
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

// defineModel keeps the native v-model on the input, which suppresses `input`
// events mid-IME-composition — important for entering place names with a
// Japanese/Chinese/Korean input method.
const location = defineModel<string>({ required: true });

defineProps<{
  suggestions: PlaceSuggestion[];
  canCreatePlace: boolean;
  isCreatingPlace: boolean;
  createPlaceError: string | null;
  placesLoadFailed: boolean;
  canonicalLocation: string;
}>();

const emit = defineEmits<{
  select: [place: PlaceSuggestion];
  create: [];
}>();
</script>
