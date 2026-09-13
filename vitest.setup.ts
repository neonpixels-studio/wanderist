import * as vue from "vue";
import { vi } from "vitest";
import { defineStore } from "pinia";

// Pin the process timezone to UTC so that any test using Date.getHours(),
// toLocaleDateString(), or similar local-time APIs produces the same output
// regardless of the CI runner's system timezone.
process.env.TZ = "UTC";

// Expose Vue composition API as globals to match Nuxt's auto-import behavior.
// Exclude `Text`/`Comment`: Vue exports these as internal VNode-type symbols,
// but the names collide with the DOM's native Text/Comment node classes.
// Vitest 5 now propagates globalThis assignments through to the happy-dom
// window (see the "DOM Environment Global Assignments" migration note), so
// assigning Vue's symbols here would overwrite happy-dom's own Text/Comment
// classes and break any render that creates a text node.
const { Text: _vueText, Comment: _vueComment, ...vueGlobals } = vue;
Object.assign(globalThis, vueGlobals);

// Stub Nuxt-only composables that are unavailable in plain Vitest
Object.assign(globalThis, {
  useHead: vi.fn(),
  useSeoMeta: vi.fn(),
  useRoute: vi.fn(() => ({ params: {}, query: {} })),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
  navigateTo: vi.fn(),
  useState: <T>(key: string, init?: () => T) => vue.ref(init?.()),
  useId: (() => {
    let n = 0;
    return () => `test-id-${++n}`;
  })(),
  useNuxtApp: vi.fn(() => ({})),
  useRuntimeConfig: vi.fn(() => ({ public: { mapboxToken: "" } })),
  useScrollReveal: vi.fn(),
  useAsyncData: vi.fn(() => ({
    data: vue.ref(null),
    pending: vue.ref(false),
    error: vue.ref(null),
    refresh: vi.fn(),
  })),
  // Clerk composables
  useClerkAuth: vi.fn(() => ({
    isSignedIn: vue.ref(false),
    isLoaded: vue.ref(true),
    getToken: vi.fn().mockResolvedValue(null),
  })),
  useClerkUser: vi.fn(() => ({ user: vue.ref(null) })),
  // Nuxt page macros
  definePageMeta: vi.fn(),
  // Pinia — use the real defineStore so stores work in component tests
  defineStore,
  // App composables — stubs for environments that don't import them explicitly
  useApiClient: vi.fn(() => ({ apiFetch: vi.fn().mockResolvedValue([]) })),
  useConnections: vi.fn(() => ({
    connections: vue.ref({
      instagram: { connected: false },
      google: { connected: false, emailAddress: null, identificationId: null },
    }),
    isLoading: vue.ref(false),
    loadError: vue.ref(null),
    actionError: vue.ref(null),
    importResult: vue.ref(null),
    fetchConnections: vi.fn().mockResolvedValue(undefined),
    startInstagramConnect: vi.fn(),
    disconnectInstagram: vi.fn().mockResolvedValue(true),
    disconnectGoogle: vi.fn().mockResolvedValue(true),
    importInstagramPhotos: vi.fn().mockResolvedValue(true),
  })),
  useSearch: vi.fn(() => ({
    query: vue.ref(""),
    results: vue.ref({ places: [], trips: [], entries: [], people: [] }),
    isLoading: vue.ref(false),
    error: vue.ref(null),
    search: vi.fn().mockResolvedValue(undefined),
  })),
  useEntryDraft: vi.fn(() => ({
    saveDraft: vi.fn(),
    loadDraft: vi.fn().mockReturnValue(null),
    clearDraft: vi.fn(),
  })),
  useMediaUpload: vi.fn(() => ({
    upload: vi.fn().mockResolvedValue({
      id: "media-1",
      url: "https://example.com/photo.jpg",
    }),
    isUploading: vue.ref(false),
    error: vue.ref(null),
  })),
  useEntriesStore: vi.fn(() => ({
    entries: vue.ref([]),
    isLoading: vue.ref(false),
    error: vue.ref(null),
    createEntry: vi.fn().mockResolvedValue({ id: "entry-1" }),
    fetchEntries: vi
      .fn()
      .mockResolvedValue({ entries: [], tab: "timeline", page: 1 }),
    fetchEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    likeEntry: vi.fn(),
    unlikeEntry: vi.fn(),
  })),
  useTripsStore: vi.fn(() => ({
    tripList: [],
    currentTripDetail: vue.ref(null),
    isLoadingList: vue.ref(false),
    isLoadingDetail: vue.ref(false),
    listError: vue.ref(null),
    detailError: vue.ref(null),
    fetchTrips: vi.fn().mockResolvedValue(undefined),
    fetchTripById: vi.fn(),
    createTrip: vi.fn(),
    patchTrip: vi.fn(),
    deleteTrip: vi.fn(),
    createStop: vi.fn(),
    patchStop: vi.fn(),
    deleteStop: vi.fn(),
    reorderStops: vi.fn(),
  })),
  usePlacesStore: vi.fn(() => ({
    places: [],
    isLoading: vue.ref(false),
    error: vue.ref(null),
    fetchPlaces: vi.fn().mockResolvedValue(undefined),
    createPlace: vi.fn(),
    updatePlace: vi.fn(),
    deletePlace: vi.fn(),
  })),
  useAccountActions: vi.fn(() => ({
    isLoading: vue.readonly(vue.ref(false)),
    passwordError: vue.readonly(vue.ref(null)),
    avatarError: vue.readonly(vue.ref(null)),
    deleteError: vue.readonly(vue.ref(null)),
    changePassword: vi.fn().mockResolvedValue(true),
    uploadAvatar: vi.fn().mockResolvedValue(null),
    removeAvatar: vi.fn().mockResolvedValue(true),
    deleteAccount: vi.fn().mockResolvedValue(true),
  })),
  usePreferences: vi.fn(() => ({
    preferences: vue.ref({
      distanceUnit: "mi",
      defaultMapStyle: "outdoors",
      publicProfile: false,
      preciseLocation: false,
      showOnExplore: true,
      displayName: null,
      handle: null,
      homeBase: null,
      bio: null,
    }),
    isLoading: vue.ref(false),
    loadError: vue.ref(null),
    saveError: vue.ref(null),
    fetchPreferences: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn().mockResolvedValue(true),
  })),
  useStats: vi.fn(() => {
    const stats = vue.ref({
      placesCount: 117,
      countriesCount: 9,
      totalDistanceMi: 48218,
      totalDistanceKm: 77600,
      currentStreak: 14,
      placesThisWeek: 6,
      distanceMiThisWeek: 1400,
      distanceKmThisWeek: 2254,
      distanceUnit: "mi",
    });
    return {
      stats,
      displayDistance: vue.computed(() => stats.value.totalDistanceMi),
      displayDistanceDelta: vue.computed(() => stats.value.distanceMiThisWeek),
      displayDistanceLabel: vue.computed(() => "Miles logged"),
      isLoading: vue.ref(false),
      loadError: vue.ref(null),
      fetchStats: vi.fn().mockResolvedValue(undefined),
    };
  }),
  useNotifications: vi.fn(() => ({
    notifications: vue.ref([]),
    isLoading: vue.ref(false),
    error: vue.ref(null),
    unreadCount: vue.computed(() => 0),
    fetchNotifications: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
  })),
});
