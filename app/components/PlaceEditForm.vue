<template>
  <section class="place-edit-form" aria-labelledby="place-edit-form-title">
    <h3 id="place-edit-form-title" class="place-edit-form__title">
      Edit place
    </h3>
    <form class="place-edit-form__body" @submit.prevent="handleSubmit">
      <InputText
        v-model="formName"
        label="Name"
        placeholder="Place name…"
        :disabled="pending"
        required
      />
      <label class="place-edit-form__field">
        <span class="place-edit-form__label">Category</span>
        <select
          v-model="formCategory"
          class="place-edit-form__select"
          :disabled="pending"
        >
          <option
            v-for="option in categoryOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
      <div class="place-edit-form__acts">
        <button
          type="submit"
          class="btn btn--primary btn--sm"
          :disabled="!formName.trim() || pending"
        >
          <AppIcon name="check" :size="14" />
          {{ pending ? "saving…" : "save changes" }}
        </button>
        <button
          type="button"
          class="btn btn--outline btn--sm"
          :disabled="pending"
          @click="emit('cancel')"
        >
          cancel
        </button>
      </div>
      <p v-if="error" class="place-edit-form__error" role="alert">
        {{ error }}
      </p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { Place, UpdatePlaceInput } from "~/stores/places";
import { PLACE_CATEGORIES } from "~/constants/placeCategories";

// The empty value clears the category. The PATCH route normalizes it to NULL,
// and the explore filters treat a falsy category as uncategorized.
const UNCATEGORIZED_VALUE = "";
const UNCATEGORIZED_OPTION = {
  label: "Uncategorized",
  value: UNCATEGORIZED_VALUE,
};

const props = withDefaults(
  defineProps<{
    place: Place;
    pending?: boolean;
    error?: string | null;
  }>(),
  {
    pending: false,
    error: null,
  },
);

const emit = defineEmits<{
  submit: [input: UpdatePlaceInput];
  cancel: [];
}>();

const formName = ref(props.place.name);
const formCategory = ref(props.place.category ?? UNCATEGORIZED_VALUE);

// A place can hold a category that predates the current list (any string is
// valid server-side). Surface it as its own option so the select shows the
// real value instead of silently falling back to "Uncategorized".
const categoryOptions = computed(() => {
  const current = props.place.category;
  const isKnown = PLACE_CATEGORIES.some(
    (category) => category.value === current,
  );

  if (!current || isKnown) {
    return [UNCATEGORIZED_OPTION, ...PLACE_CATEGORIES];
  }

  return [
    UNCATEGORIZED_OPTION,
    { label: current, value: current },
    ...PLACE_CATEGORIES,
  ];
});

// Resync only when a genuinely different place is edited, so a store refetch
// that returns a new object for the same place doesn't wipe an in-progress
// edit. The map remounts this per place via :key; this keeps the component
// self-correct for any caller that keeps it mounted across selections.
watch(
  () => props.place.id,
  () => {
    formName.value = props.place.name;
    formCategory.value = props.place.category ?? UNCATEGORIZED_VALUE;
  },
);

function buildChangedFields(): UpdatePlaceInput {
  const changes: UpdatePlaceInput = {};
  const name = formName.value.trim();

  if (name !== props.place.name) {
    changes.name = name;
  }

  const originalCategory = props.place.category ?? UNCATEGORIZED_VALUE;
  if (formCategory.value !== originalCategory) {
    changes.category = formCategory.value;
  }

  return changes;
}

function handleSubmit(): void {
  if (!formName.value.trim()) {
    return;
  }

  const changes = buildChangedFields();

  // Nothing changed — close the form without a no-op request that the PATCH
  // route would reject with "No valid fields provided for update".
  if (Object.keys(changes).length === 0) {
    emit("cancel");
    return;
  }

  emit("submit", changes);
}
</script>

<style scoped>
.place-edit-form {
  padding: 16px;
  border-top: 1px solid var(--line);
}
.place-edit-form__title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}
.place-edit-form__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.place-edit-form__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--ink-2);
}
.place-edit-form__select {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  padding: 8px 10px;
  font-size: 13px;
  color: var(--ink);
  outline: none;
}
.place-edit-form__select:focus {
  border-color: var(--accent-line);
}
.place-edit-form__acts {
  display: flex;
  gap: 10px;
}
.place-edit-form__error {
  font-size: 12px;
  color: var(--error, #c0392b);
  margin: 0;
}
</style>
