import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import MapPage from "../map.vue";
import PlaceEditForm from "~/components/PlaceEditForm.vue";
import { pageGlobalConfig as globalConfig } from "./test-utils";

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

// useMapbox is stubbed so tests don't need a real Mapbox token or DOM canvas.
// hasToken returns false so the fallback (DOM pins) path is active throughout.
const mockSyncMarkers = vi.fn().mockResolvedValue(undefined);
const mockInitMap = vi.fn().mockResolvedValue(null);
const mockSetStyle = vi.fn();
const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();
const mockSetMarkerActive = vi.fn();
const mockStartDropPin = vi.fn();
const mockCancelDropPin = vi.fn();
const mockDestroyMap = vi.fn();

vi.stubGlobal("useMapbox", () => ({
  hasToken: () => false,
  initMap: mockInitMap,
  setStyle: mockSetStyle,
  zoomIn: mockZoomIn,
  zoomOut: mockZoomOut,
  syncMarkers: mockSyncMarkers,
  setMarkerActive: mockSetMarkerActive,
  startDropPin: mockStartDropPin,
  cancelDropPin: mockCancelDropPin,
  destroyMap: mockDestroyMap,
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
