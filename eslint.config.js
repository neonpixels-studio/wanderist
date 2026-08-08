import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Vue 3 composables and utilities auto-imported by Nuxt
const vueGlobals = {
  ref: "readonly",
  computed: "readonly",
  reactive: "readonly",
  readonly: "readonly",
  watch: "readonly",
  watchEffect: "readonly",
  watchPostEffect: "readonly",
  watchSyncEffect: "readonly",
  inject: "readonly",
  provide: "readonly",
  onMounted: "readonly",
  onBeforeMount: "readonly",
  onUpdated: "readonly",
  onBeforeUpdate: "readonly",
  onUnmounted: "readonly",
  onBeforeUnmount: "readonly",
  onErrorCaptured: "readonly",
  onActivated: "readonly",
  onDeactivated: "readonly",
  onServerPrefetch: "readonly",
  nextTick: "readonly",
  defineComponent: "readonly",
  defineAsyncComponent: "readonly",
  h: "readonly",
  toRef: "readonly",
  toRefs: "readonly",
  toRaw: "readonly",
  markRaw: "readonly",
  shallowRef: "readonly",
  shallowReactive: "readonly",
  shallowReadonly: "readonly",
  triggerRef: "readonly",
  customRef: "readonly",
  isRef: "readonly",
  unref: "readonly",
  isProxy: "readonly",
  isReactive: "readonly",
  isReadonly: "readonly",
  useAttrs: "readonly",
  useSlots: "readonly",
  resolveComponent: "readonly",
};

// Nuxt auto-imports
const nuxtGlobals = {
  definePageMeta: "readonly",
  defineNuxtComponent: "readonly",
  defineNuxtPlugin: "readonly",
  defineNuxtRouteMiddleware: "readonly",
  useHead: "readonly",
  useSeoMeta: "readonly",
  navigateTo: "readonly",
  clearError: "readonly",
  showError: "readonly",
  abortNavigation: "readonly",
  useState: "readonly",
  useRoute: "readonly",
  useRouter: "readonly",
  useNuxtApp: "readonly",
  useRuntimeConfig: "readonly",
  useFetch: "readonly",
  useAsyncData: "readonly",
  useId: "readonly",
  useCookie: "readonly",
  useError: "readonly",
  useRequestEvent: "readonly",
  useRequestHeaders: "readonly",
  useRequestURL: "readonly",
};

// Project-specific auto-imports (composables and Clerk wrappers)
const projectGlobals = {
  useTheme: "readonly",
  useScrollReveal: "readonly",
  useClerkUser: "readonly",
  useClerkAuth: "readonly",
  useApiClient: "readonly",
  useFollows: "readonly",
  useProfile: "readonly",
  useSearch: "readonly",
  useMapbox: "readonly",
  useMapboxStyles: "readonly",
  resolveMapboxStyleLabel: "readonly",
  resolveMapboxStyleUrl: "readonly",
  useAccountActions: "readonly",
  usePreferences: "readonly",
  useMediaUpload: "readonly",
  useEntryDraft: "readonly",
  useEntriesStore: "readonly",
  useTripsStore: "readonly",
  usePlacesStore: "readonly",
  useDiscover: "readonly",
  useNotifications: "readonly",
  useCommandPaletteShortcut: "readonly",
};

export default [
  js.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  prettier,
  {
    languageOptions: {
      parser: pluginVue.parser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: [".vue"],
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...vueGlobals,
        ...nuxtGlobals,
        ...projectGlobals,
      },
    },
  },
  // Nuxt pages and layouts use single-word file names by convention
  {
    files: ["app/pages/**/*.vue", "app/layouts/**/*.vue", "app/error.vue"],
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
  {
    ignores: [
      ".netlify/**",
      ".nuxt/**",
      ".output/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
];
