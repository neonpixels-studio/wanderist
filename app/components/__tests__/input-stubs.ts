/**
 * InputText/InputTextarea are resolved via Nuxt's components/ auto-import at
 * build time, which plain Vitest can't do — stub them with a working
 * v-model relay so setValue() interactions in tests still reach the
 * consuming component's refs.
 */
export const inputStub = {
  props: ["modelValue", "label", "placeholder", "required", "disabled"],
  emits: ["update:modelValue"],
  template:
    '<input :placeholder="placeholder" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

export const textareaStub = {
  props: ["modelValue", "label", "placeholder", "rows"],
  emits: ["update:modelValue"],
  template:
    '<textarea :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
};

/**
 * NuxtLink is resolved via Nuxt's build-time components, which plain Vitest
 * can't do — render it as a plain anchor so tests can assert the resolved
 * `href` (and so mounting a component that links out doesn't warn about an
 * unresolved component).
 */
export const nuxtLinkStub = {
  props: ["to"],
  template: '<a :href="to"><slot /></a>',
};
