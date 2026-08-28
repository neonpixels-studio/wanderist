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
    <p v-if="willNotSave" class="error-hint" data-test="location-warning">
      “{{ modelValue }}” isn’t one of your saved places, so it won’t be attached
      to this entry.
    </p>
    <p
      v-if="placesUnavailable && modelValue.trim()"
      class="error-hint"
      data-test="places-load-error"
    >
      We couldn’t load your saved places, so “{{ modelValue }}” won’t be
      attached to this entry.
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
  willNotSave: boolean;
  placesUnavailable: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  select: [place: PlaceSuggestion];
}>();

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>
