import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed, reactive } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import MapPage from "../map.vue";
import PlaceEditForm from "~/components/PlaceEditForm.vue";
import { pageGlobalConfig as globalConfig } from "./test-utils";

// Explore's trending-place cards link here with the place name as a `place`
// query param (see issue #218). Reactive (like Nuxt's real useRoute) so the
// page's watch(() => route.query.place, ...) can be exercised by mutating
// this after mount; reset in beforeEach so it doesn't leak between tests.
const routeQuery = reactive<{
  place?: string | string[];
  country?: string;
  category?: string;
}>({});
vi.stubGlobal("useRoute", () => ({ params: {}, query: routeQuery }));

const mockMapStats = ref({
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

vi.mock("~/composables/useStats", () => ({
  useStats: vi.fn(() => ({
    stats: mockMapStats,
    displayDistance: computed(() => mockMapStats.value.totalDistanceMi),
    displayDistanceDelta: computed(() => mockMapStats.value.distanceMiThisWeek),
    displayDistanceLabel: computed(() => "Miles logged"),
    isLoading: ref(false),
    loadError: ref(null),
    fetchStats: vi.fn().mockResolvedValue(undefined),
  })),
}));

// useApiClient is a Nuxt auto-import used by usePlacesStore. usePlacesStore
// walks pages of GET /api/places until a response reports hasMore: false, so
// this stub inspects the requested page and only returns data for page 1.
const mockApiFetch = vi.fn();
vi.stubGlobal("useApiClient", () => ({ apiFetch: mockApiFetch }));

function stubPaginatedPlacesResponse(places: unknown[]) {
  mockApiFetch.mockImplementation(async (url: string) => {
    const page = Number(
      new URL(url, "http://localhost").searchParams.get("page"),
    );
    return { places: page === 1 ? places : [], page, hasMore: false };
  });
}

// defineStore is stubbed as vi.fn() in vitest.setup.ts for snapshot/component
// tests. Override it to the real pinia defineStore so the store actually works.
const { defineStore } = await import("pinia");
vi.stubGlobal("defineStore", defineStore);

// map.vue imports useMapbox directly from its module (not via Nuxt's
// auto-import global), so it must be mocked with vi.mock rather than
// vi.stubGlobal — the same reason useStats is mocked this way above.
// hasToken defaults to false so the fallback (DOM pins) path is active
// throughout, except in the tests that opt into the token-present path.
const mockSyncMarkers = vi.fn().mockResolvedValue(undefined);
const mockInitMap = vi.fn().mockResolvedValue(null);
const mockSetStyle = vi.fn();
const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();
const mockSetMarkerActive = vi.fn();
const mockStartDropPin = vi.fn();
const mockCancelDropPin = vi.fn();
const mockDestroyMap = vi.fn();
const mockFlyTo = vi.fn();

// hasToken is mutable so a test can opt into the token-present path (real map
// init + the 'load' callback) without every other test paying for a fake map
// instance it doesn't need.
let mockHasToken = false;

vi.mock("~/composables/useMapbox", () => ({
  useMapbox: () => ({
    hasToken: () => mockHasToken,
    initMap: mockInitMap,
    setStyle: mockSetStyle,
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    flyTo: mockFlyTo,
    syncMarkers: mockSyncMarkers,
    setMarkerActive: mockSetMarkerActive,
    startDropPin: mockStartDropPin,
    cancelDropPin: mockCancelDropPin,
    destroyMap: mockDestroyMap,
  }),
}));

// useMapboxStyles is auto-imported; stub the composable wrapper and the named
// export that map.vue imports directly.
vi.stubGlobal("useMapboxStyles", () => ({
  resolveMapboxStyleUrl: (key: string) => `mapbox://styles/mapbox/${key}-stub`,
  resolveMapboxStyleLabel: (key: string) => `${key}-label`,
}));
vi.stubGlobal("resolveMapboxStyleLabel", (key: string) => {
  const labels: Record<string, string> = {
    outdoors: "outdoors-v12",
    streets: "streets-v12",
    satellite: "satellite-streets-v12",
    light: "light-v11",
    dark: "dark-v11",
    custom: "wanderist-violet",
  };
  return labels[key] ?? key;
});

const SAMPLE_PLACES = [
  {
    id: "p-1",
    userId: "u-1",
    name: "Reykjavík",
    subtitle: "Iceland · current trip",
    country: "Iceland",
    category: "city",
    latitude: 64.1355,
    longitude: -21.8954,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "p-2",
    userId: "u-1",
    name: "Tokyo",
    subtitle: "Japan · 2025",
    country: "Japan",
    category: "city",
    latitude: 35.6762,
    longitude: 139.6503,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "p-3",
    userId: "u-1",
    name: "Lisbon",
    subtitle: "Portugal",
    country: "Portugal",
    category: null,
    latitude: null,
    longitude: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
];

// A minimal stand-in for a mapbox-gl Map: captures the 'load' handler
// map.vue registers so a test can invoke it once, the way mapbox-gl would
// when the style finishes loading.
function createFakeMapInstance() {
  let loadHandler: (() => void | Promise<void>) | undefined;

  return {
    on: vi.fn((event: string, handler: () => void | Promise<void>) => {
      if (event === "load") {
        loadHandler = handler;
      }
    }),
    triggerLoad: async () => {
      await loadHandler?.();
    },
  };
}

async function mountWithPlaces(places = SAMPLE_PLACES) {
  // Make apiFetch return the given places so onMounted's fetchPlaces() call
  // populates the store with the expected data rather than clobbering it with [].
  stubPaginatedPlacesResponse(places);

  const pinia = createPinia();
  setActivePinia(pinia);

  const wrapper = mount(MapPage, {
    ...globalConfig,
    global: {
      ...globalConfig.global,
      plugins: [pinia],
      // PlaceEditForm is a Nuxt components/ auto-import that plain Vitest can't
      // resolve; register the real component so the edit-form wiring renders.
      components: { PlaceEditForm },
    },
  });

  // Drain the async onMounted queue so fetchPlaces() resolves and the store
  // is populated before assertions run.
  await flushPromises();

  return wrapper;
}

describe("Map page (/map)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPaginatedPlacesResponse([]);
    setActivePinia(createPinia());
    delete routeQuery.place;
    delete routeQuery.country;
    delete routeQuery.category;
    mockHasToken = false;
    mockInitMap.mockResolvedValue(null);
  });

  it("renders the map stage and matches snapshot", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".map-stage").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the places panel with store places", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.findAll(".place-item")).toHaveLength(SAMPLE_PLACES.length);
  });

  it("renders fallback DOM pins for places with lat/lng when mapbox token is absent", async () => {
    const wrapper = await mountWithPlaces();
    // Only Reykjavík and Tokyo have lat/lng; Lisbon does not.
    expect(wrapper.findAll(".pin-abs")).toHaveLength(2);
  });

  it("renders 4 filter chips", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.findAll(".chip")).toHaveLength(4);
  });

  it("activates filter chip when clicked", async () => {
    const wrapper = await mountWithPlaces();
    const chips = wrapper.findAll(".chip");
    await chips[1].trigger("click");
    expect(chips[1].classes()).toContain("is-active");
    expect(chips[0].classes()).not.toContain("is-active");
  });

  it("shows no detail card on initial load (no place pre-selected)", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".detail.is-open").exists()).toBe(false);
  });

  it("updates detail card when a place is selected", async () => {
    const wrapper = await mountWithPlaces();
    const items = wrapper.findAll(".place-item");
    await items[0].trigger("click");
    expect(wrapper.find(".detail__name").text()).toBe("Reykjavík");
  });

  it("closes detail card when close button is clicked", async () => {
    const wrapper = await mountWithPlaces();
    const items = wrapper.findAll(".place-item");
    await items[0].trigger("click");
    expect(wrapper.find(".detail.is-open").exists()).toBe(true);

    await wrapper.find(".detail__close").trigger("click");
    expect(wrapper.find(".detail.is-open").exists()).toBe(false);
  });

  it("renders 6 map style options", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.findAll(".lstyle")).toHaveLength(6);
  });

  it("defaults to outdoors map style", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".map-stage").attributes("data-mapstyle")).toBe(
      "outdoors",
    );
  });

  it("changes map style when a style is selected", async () => {
    const wrapper = await mountWithPlaces();
    const styles = wrapper.findAll(".lstyle");
    await styles[2].trigger("click");
    expect(wrapper.find(".map-stage").attributes("data-mapstyle")).toBe(
      "satellite",
    );
  });

  it("toggles the layers popover when button is clicked", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".layers-pop.is-open").exists()).toBe(false);
    await wrapper.find(".map-cbtn").trigger("click");
    expect(wrapper.find(".layers-pop.is-open").exists()).toBe(true);
  });

  it("closes the layers popover after selecting a style", async () => {
    const wrapper = await mountWithPlaces();
    await wrapper.find(".map-cbtn").trigger("click");
    await wrapper.findAll(".lstyle")[1].trigger("click");
    expect(wrapper.find(".layers-pop.is-open").exists()).toBe(false);
  });

  it("shows the legend with current style name and pin count from store", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".legend").text()).toContain("outdoors-v12");
    // Only 2 of the 3 sample places have lat/lng (Lisbon has null coords).
    expect(wrapper.find(".legend").text()).toContain("2 pins");
  });

  it("filters place list when search is typed (client-side name/subtitle match)", async () => {
    const wrapper = await mountWithPlaces();

    const input = wrapper.find(".places__search input");
    await input.setValue("tokyo");
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll(".place-item")).toHaveLength(1);
    expect(wrapper.find(".place-item__name").text()).toBe("Tokyo");
  });

  it("shows an empty-state note when a typed search matches nothing", async () => {
    const wrapper = await mountWithPlaces();

    const input = wrapper.find(".places__search input");
    await input.setValue("nowhere");
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll(".place-item")).toHaveLength(0);
    expect(wrapper.find(".place-list .empty-note").exists()).toBe(true);
  });

  it("does not show the empty-state note when the search box is empty", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".place-list .empty-note").exists()).toBe(false);
  });

  it("shows all places when the search query is cleared", async () => {
    const wrapper = await mountWithPlaces();

    const input = wrapper.find(".places__search input");
    await input.setValue("tokyo");
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".place-item")).toHaveLength(1);

    await input.setValue("");
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".place-item")).toHaveLength(SAMPLE_PLACES.length);
  });

  it("shows the place count from store in the topbar tag", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".tag.tag--accent").text()).toContain(
      `${SAMPLE_PLACES.length} places`,
    );
  });

  it("renders an empty list when store has no places", async () => {
    const wrapper = await mountWithPlaces([]);
    expect(wrapper.findAll(".place-item")).toHaveLength(0);
    expect(wrapper.findAll(".pin-abs")).toHaveLength(0);
    expect(wrapper.find(".legend").text()).toContain("0 pins");
  });

  it("does not show drop-pin mode banner initially", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".drop-pin-banner").exists()).toBe(false);
  });

  it("does not show drop-pin form initially", async () => {
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".drop-pin-form").exists()).toBe(false);
  });

  it("does not call startDropPin when no map instance is active (no token)", async () => {
    const wrapper = await mountWithPlaces();
    const dropPinButton = wrapper.find(".btn.btn--primary.btn--sm");
    await dropPinButton.trigger("click");
    // hasToken() returns false so onDropPin returns early
    expect(mockStartDropPin).not.toHaveBeenCalled();
  });

  it("does not show the edit form until the edit button is clicked", async () => {
    const wrapper = await mountWithPlaces();
    await wrapper.findAll(".place-item")[0].trigger("click");
    expect(wrapper.find(".place-edit-form").exists()).toBe(false);

    await wrapper.find('button[aria-label="Edit place"]').trigger("click");
    expect(wrapper.find(".place-edit-form").exists()).toBe(true);
  });

  it("PATCHes the place and refreshes the detail card on save", async () => {
    const wrapper = await mountWithPlaces();
    await wrapper.findAll(".place-item")[0].trigger("click");
    await wrapper.find('button[aria-label="Edit place"]').trigger("click");

    const updated = {
      ...SAMPLE_PLACES[0],
      name: "Reykjavík",
      category: "nature",
    };
    mockApiFetch.mockResolvedValueOnce(updated);

    await wrapper.find(".place-edit-form__select").setValue("nature");
    await wrapper.find(".place-edit-form form").trigger("submit");
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/places/p-1", {
      method: "PATCH",
      body: { category: "nature" },
    });
    expect(wrapper.find(".place-edit-form").exists()).toBe(false);
    // The detail card reflects the response returned by the store.
    expect(wrapper.find(".detail__name").text()).toBe("Reykjavík");
  });

  it("renders the update error and keeps the form open when the PATCH fails", async () => {
    const wrapper = await mountWithPlaces();
    await wrapper.findAll(".place-item")[0].trigger("click");
    await wrapper.find('button[aria-label="Edit place"]').trigger("click");

    mockApiFetch.mockRejectedValueOnce(new Error("Save failed"));

    await wrapper.find(".place-edit-form__select").setValue("nature");
    await wrapper.find(".place-edit-form form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".place-edit-form__error").text()).toBe("Save failed");
    expect(wrapper.find(".place-edit-form").exists()).toBe(true);
  });

  it("closes the edit form when a different place is selected", async () => {
    const wrapper = await mountWithPlaces();
    await wrapper.findAll(".place-item")[0].trigger("click");
    await wrapper.find('button[aria-label="Edit place"]').trigger("click");
    expect(wrapper.find(".place-edit-form").exists()).toBe(true);

    await wrapper.findAll(".place-item")[1].trigger("click");
    expect(wrapper.find(".place-edit-form").exists()).toBe(false);
  });

  it("auto-selects and pre-fills search for a place matching the ?place= query param", async () => {
    routeQuery.place = "Tokyo";
    const wrapper = await mountWithPlaces();

    expect(
      (wrapper.find(".places__search input").element as HTMLInputElement).value,
    ).toBe("Tokyo");
    expect(wrapper.find(".detail.is-open").exists()).toBe(true);
    expect(wrapper.find(".detail__name").text()).toBe("Tokyo");
  });

  it("matches the ?place= query param case-insensitively", async () => {
    routeQuery.place = "tokyo";
    const wrapper = await mountWithPlaces();

    expect(wrapper.find(".detail__name").text()).toBe("Tokyo");
  });

  it("matches the ?place= query param independent of Unicode normalization", async () => {
    // "í" as a single precomposed code point (NFC) vs. "i" + combining acute
    // accent (NFD) look identical but compare unequal without normalizing.
    routeQuery.place = "Reykjavík";
    const wrapper = await mountWithPlaces();

    expect(wrapper.find(".detail__name").text()).toBe("Reykjavík");
  });

  it("uses ?country= to disambiguate two saved places sharing a name", async () => {
    const duplicateNamePlaces = [
      {
        id: "p-lisbon-pt",
        userId: "u-1",
        name: "Lisbon",
        subtitle: "Portugal",
        country: "Portugal",
        category: "city",
        latitude: 38.7223,
        longitude: -9.1393,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
      {
        id: "p-lisbon-oh",
        userId: "u-1",
        name: "Lisbon",
        subtitle: "Ohio, USA",
        country: "United States",
        category: "city",
        latitude: 41.4531,
        longitude: -82.6021,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    ];
    routeQuery.place = "Lisbon";
    routeQuery.country = "United States";
    const wrapper = await mountWithPlaces(duplicateNamePlaces);

    expect(wrapper.find(".detail__name").text()).toBe("Lisbon");
    expect(wrapper.find(".detail__loc").text()).toBe("Ohio, USA");
  });

  it("pre-fills search but selects nothing when ?place= matches no saved place", async () => {
    // Trending places are aggregated across all users (see fetchTrendingPlaces),
    // so most clicked-through names won't be among the viewer's own places —
    // there is no marker to focus, only the search list to narrow.
    routeQuery.place = "Reynisfjara";
    const wrapper = await mountWithPlaces();

    expect(
      (wrapper.find(".places__search input").element as HTMLInputElement).value,
    ).toBe("Reynisfjara");
    expect(wrapper.find(".detail.is-open").exists()).toBe(false);
    expect(wrapper.findAll(".place-item")).toHaveLength(0);
    // The viewer shouldn't be left wondering why their whole places list
    // just vanished after clicking a trending card.
    expect(wrapper.find(".place-list .empty-note").text()).toContain(
      "Reynisfjara",
    );
  });

  it("ignores a repeated ?place= param (Vue Router yields a string array)", async () => {
    routeQuery.place = ["Tokyo", "Kyoto"];
    const wrapper = await mountWithPlaces();

    expect(wrapper.find(".detail.is-open").exists()).toBe(false);
    expect(
      (wrapper.find(".places__search input").element as HTMLInputElement).value,
    ).toBe("");
  });

  it("re-resolves the focused place when the ?place= query changes while already on the page", async () => {
    routeQuery.place = "Tokyo";
    const wrapper = await mountWithPlaces();
    expect(wrapper.find(".detail__name").text()).toBe("Tokyo");

    routeQuery.place = "Reykjavík";
    await wrapper.vm.$nextTick();
    await flushPromises();

    expect(wrapper.find(".detail__name").text()).toBe("Reykjavík");
    expect(
      (wrapper.find(".places__search input").element as HTMLInputElement).value,
    ).toBe("Reykjavík");
  });

  it("does not select or filter when no ?place= query param is present", async () => {
    const wrapper = await mountWithPlaces();

    expect(
      (wrapper.find(".places__search input").element as HTMLInputElement).value,
    ).toBe("");
    expect(wrapper.find(".detail.is-open").exists()).toBe(false);
    expect(wrapper.findAll(".place-item")).toHaveLength(SAMPLE_PLACES.length);
  });

  it("clears the search filter when the ?place= query is removed", async () => {
    routeQuery.place = "Tokyo";
    const wrapper = await mountWithPlaces();
    expect(wrapper.findAll(".place-item")).toHaveLength(1);

    delete routeQuery.place;
    await wrapper.vm.$nextTick();
    await flushPromises();

    expect(
      (wrapper.find(".places__search input").element as HTMLInputElement).value,
    ).toBe("");
    expect(wrapper.findAll(".place-item")).toHaveLength(SAMPLE_PLACES.length);
  });

  it("pans the camera to the focused place once the map finishes loading", async () => {
    mockHasToken = true;
    const fakeMapInstance = createFakeMapInstance();
    mockInitMap.mockResolvedValueOnce(fakeMapInstance);
    routeQuery.place = "Tokyo";

    const wrapper = await mountWithPlaces();
    await fakeMapInstance.triggerLoad();
    await flushPromises();

    expect(mockFlyTo).toHaveBeenCalledWith(fakeMapInstance, 139.6503, 35.6762);
    expect(wrapper.find(".detail__name").text()).toBe("Tokyo");
  });

  it("does not pan the camera for a focused place with no coordinates", async () => {
    mockHasToken = true;
    const fakeMapInstance = createFakeMapInstance();
    mockInitMap.mockResolvedValueOnce(fakeMapInstance);
    routeQuery.place = "Lisbon";

    await mountWithPlaces();
    await fakeMapInstance.triggerLoad();
    await flushPromises();

    expect(mockFlyTo).not.toHaveBeenCalled();
  });

  it("does not pan the camera when no place matches the query", async () => {
    mockHasToken = true;
    const fakeMapInstance = createFakeMapInstance();
    mockInitMap.mockResolvedValueOnce(fakeMapInstance);
    routeQuery.place = "Reynisfjara";

    await mountWithPlaces();
    await fakeMapInstance.triggerLoad();
    await flushPromises();

    expect(mockFlyTo).not.toHaveBeenCalled();
  });

  it("pans the camera when the ?place= query changes while already on the page", async () => {
    // This is the scenario the route.query.place watcher exists for: the map
    // is already live (token present, 'load' already fired) and the viewer
    // clicks a second trending card without leaving /map.
    mockHasToken = true;
    const fakeMapInstance = createFakeMapInstance();
    mockInitMap.mockResolvedValueOnce(fakeMapInstance);
    routeQuery.place = "Tokyo";

    const wrapper = await mountWithPlaces();
    await fakeMapInstance.triggerLoad();
    await flushPromises();
    expect(mockFlyTo).toHaveBeenCalledWith(fakeMapInstance, 139.6503, 35.6762);
    mockFlyTo.mockClear();

    routeQuery.place = "Reykjavík";
    await wrapper.vm.$nextTick();
    await flushPromises();

    expect(mockFlyTo).toHaveBeenCalledWith(fakeMapInstance, -21.8954, 64.1355);
  });

  it("shows places error alert when fetchPlaces fails", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("Network error"));
    const pinia = createPinia();
    setActivePinia(pinia);
    const errorWrapper = mount(MapPage, {
      ...globalConfig,
      global: {
        ...globalConfig.global,
        plugins: [pinia],
      },
    });
    await flushPromises();
    expect(errorWrapper.find(".places-error").exists()).toBe(true);
    expect(errorWrapper.find(".places-error").text()).toContain(
      "Network error",
    );
  });
});
