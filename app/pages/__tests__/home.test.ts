import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, computed } from "vue";
import { mount } from "@vue/test-utils";
import HomePage from "../home.vue";
import { pageGlobalConfig as globalConfig } from "./test-utils";
import type { Place } from "~/stores/places";
import type { Entry } from "~/stores/entries";
import type { Trip, TripDetail } from "~/stores/trips";

// ── Composable mocks (explicitly imported in home.vue) ────────────────────────

// These must use vi.mock (hoisted) because home.vue imports them directly via
// named import rather than accessing them as Nuxt globals.

const mockStatsRef = ref({
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
const mockFetchStats = vi.fn().mockResolvedValue(undefined);

vi.mock("~/composables/useStats", () => ({
  useStats: vi.fn(() => ({
    stats: mockStatsRef,
    displayDistance: computed(() => mockStatsRef.value.totalDistanceMi),
    displayDistanceDelta: computed(() => mockStatsRef.value.distanceMiThisWeek),
    displayDistanceLabel: computed(() => "Miles logged"),
    isLoading: ref(false),
    loadError: ref(null),
    fetchStats: mockFetchStats,
  })),
}));

const mockInstagramConnected = ref(true);
const mockImportResult = ref<{
  imported: number;
  skipped: number;
  errors: string[];
} | null>(null);
const mockFetchConnections = vi.fn().mockResolvedValue(undefined);
const mockImportInstagramPhotos = vi.fn().mockResolvedValue(true);

vi.mock("~/composables/useConnections", () => ({
  useConnections: vi.fn(() => ({
    connections: computed(() => ({
      instagram: { connected: mockInstagramConnected.value },
      google: { connected: false, emailAddress: null, identificationId: null },
    })),
    importResult: mockImportResult,
    actionError: ref(null),
    importInstagramPhotos: mockImportInstagramPhotos,
    fetchConnections: mockFetchConnections,
    startInstagramConnect: vi.fn(),
    disconnectInstagram: vi.fn().mockResolvedValue(true),
    disconnectGoogle: vi.fn().mockResolvedValue(true),
  })),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_PLACES: Place[] = [
  {
    id: "p-1",
    userId: "u-1",
    name: "Reykjavík",
    subtitle: null,
    country: "IS",
    latitude: 64.13,
    longitude: -21.82,
    category: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "p-2",
    userId: "u-1",
    name: "London",
    subtitle: null,
    country: "GB",
    latitude: 51.51,
    longitude: -0.13,
    category: null,
    createdAt: "2024-01-02T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  },
];

const SAMPLE_ENTRIES: Entry[] = [
  {
    id: "e-1",
    userId: "u-1",
    tripId: "t-1",
    placeId: "p-1",
    title: "Harbor at 4am",
    body: "Cold morning, the whole harbor still asleep.",
    occurredAt: "2024-06-12T10:00:00.000Z",
    visibility: "private",
    weather: null,
    likeCount: 24,
    createdAt: "2024-06-12T10:00:00.000Z",
    updatedAt: "2024-06-12T10:00:00.000Z",
    photos: [{ id: "ph-1", entryId: "e-1", mediaId: "m-1", sortOrder: 0 }],
    tags: [],
  },
  {
    id: "e-2",
    userId: "u-1",
    tripId: null,
    placeId: null,
    title: "Tram 28, again",
    body: "Took the long way through Alfama.",
    occurredAt: "2024-06-08T10:00:00.000Z",
    visibility: "private",
    weather: null,
    likeCount: 41,
    createdAt: "2024-06-08T10:00:00.000Z",
    updatedAt: "2024-06-08T10:00:00.000Z",
    photos: [],
    tags: [],
  },
];

const SAMPLE_TRIP: Trip = {
  id: "t-1",
  userId: "u-1",
  name: "Iceland, the ring road",
  status: "ongoing",
  startDate: "2024-06-09T00:00:00.000Z",
  endDate: "2024-06-17T00:00:00.000Z",
  coverImageId: null,
  distanceKm: null,
  visibility: "private",
  createdAt: "2024-06-01T00:00:00.000Z",
  updatedAt: "2024-06-01T00:00:00.000Z",
};

const SAMPLE_TRIP_DETAIL: TripDetail = {
  trip: SAMPLE_TRIP,
  stops: [
    {
      id: "s-1",
      tripId: "t-1",
      placeId: null,
      name: "Reykjavík",
      sortOrder: 0,
      arriveDate: null,
      nights: 2,
      note: null,
      distanceKm: null,
      status: "done",
    },
    {
      id: "s-2",
      tripId: "t-1",
      placeId: null,
      name: "Jökulsárlón",
      sortOrder: 1,
      arriveDate: null,
      nights: 1,
      note: "glacier lagoon · 1h 40m drive",
      distanceKm: null,
      status: "next",
    },
    {
      id: "s-3",
      tripId: "t-1",
      placeId: null,
      name: "Akureyri",
      sortOrder: 2,
      arriveDate: null,
      nights: 1,
      note: null,
      distanceKm: null,
      status: "planned",
    },
  ],
  facts: {
    distanceKm: null,
    loggedDistanceKm: null,
    nights: 4,
    photoCount: 0,
    stopCount: 3,
  },
};

// ── Store state (Pinia stores are Nuxt global auto-imports; override via
//    vi.stubGlobal, which runs after vitest.setup.ts) ──────────────────────────

const placesRef = ref<Place[]>([...SAMPLE_PLACES]);
const entriesRef = ref<Entry[]>([...SAMPLE_ENTRIES]);
const tripListRef = ref<Trip[]>([SAMPLE_TRIP]);
const tripDetailRef = ref<TripDetail | null>(SAMPLE_TRIP_DETAIL);

vi.stubGlobal(
  "usePlacesStore",
  vi.fn(() => ({
    places: placesRef.value,
    isLoading: false,
    error: null,
    fetchPlaces: vi.fn().mockResolvedValue(undefined),
    createPlace: vi.fn(),
    updatePlace: vi.fn(),
    deletePlace: vi.fn(),
  })),
);

vi.stubGlobal(
  "useEntriesStore",
  vi.fn(() => ({
    entries: entriesRef.value,
    isLoading: false,
    error: null,
    fetchEntries: vi.fn().mockResolvedValue(undefined),
    fetchEntry: vi.fn(),
    createEntry: vi.fn().mockResolvedValue({ id: "entry-1" }),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    likeEntry: vi.fn(),
    unlikeEntry: vi.fn(),
  })),
);

vi.stubGlobal(
  "useTripsStore",
  vi.fn(() => ({
    tripList: tripListRef.value,
    currentTripDetail: tripDetailRef.value,
    isLoadingList: false,
    isLoadingDetail: false,
    listError: null,
    detailError: null,
    fetchTrips: vi.fn().mockResolvedValue(undefined),
    fetchTripById: vi.fn().mockResolvedValue(undefined),
    createTrip: vi.fn(),
    patchTrip: vi.fn(),
    deleteTrip: vi.fn(),
    createStop: vi.fn(),
    patchStop: vi.fn(),
    deleteStop: vi.fn(),
    reorderStops: vi.fn(),
  })),
);

vi.stubGlobal(
  "useClerkUser",
  vi.fn(() => ({
    user: ref({
      firstName: "Dan",
      fullName: "Dan Holloran",
      username: null,
      imageUrl: null,
      primaryEmailAddress: { emailAddress: "dan@example.com" },
    }),
    isLoaded: ref(true),
    isSignedIn: ref(true),
  })),
);

// ── Tests ─────────────────────────────────────────────────────────────────────

// Fixed point in time: Friday evening, Jun 14 2024 at 19:00 UTC.
// This makes timeOfDayLabel ("evening") and localDateLabel ("fri, jun 14")
// deterministic so the snapshot does not change between runs.
const FIXED_NOW_ISO = "2024-06-14T19:00:00Z";

describe("Home / Dashboard page (/home)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW_ISO));

    placesRef.value = [...SAMPLE_PLACES];
    entriesRef.value = [...SAMPLE_ENTRIES];
    tripListRef.value = [SAMPLE_TRIP];
    tripDetailRef.value = SAMPLE_TRIP_DETAIL;
    mockInstagramConnected.value = true;
    mockImportResult.value = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders without crashing and matches snapshot", async () => {
    const wrapper = mount(HomePage, globalConfig);
    // onMounted fires asynchronously in happy-dom; flush the lifecycle before
    // capturing the snapshot so time-of-day labels are populated.
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".hello").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the greeting with the Clerk user's first name", () => {
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".hello h1").text()).toContain("Welcome back");
    expect(wrapper.find(".hello h1 b").text()).toBe("Dan.");
  });

  it("renders a dynamic time-of-day label in the greeting", async () => {
    const wrapper = mount(HomePage, globalConfig);
    // onMounted populates the time labels; flush the lifecycle first.
    await wrapper.vm.$nextTick();
    const label = wrapper.find(".hello .label").text();
    // Format: "// <time-of-day> · <day>, <month> <date>"
    expect(label).toMatch(/^\/\/ (morning|afternoon|evening|night) · /);
  });

  it("renders 4 stat cards", () => {
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.findAll(".stat")).toHaveLength(4);
  });

  it("renders stat values from useStats composable", () => {
    const wrapper = mount(HomePage, globalConfig);
    const nums = wrapper.findAll(".stat__num").map((element) => element.text());
    expect(nums).toContain("117");
    expect(nums).toContain("9");
    expect(nums).toContain("48.2k");
    expect(nums).toContain("14");
  });

  it("shows the import alert when Instagram is connected", () => {
    mockInstagramConnected.value = true;
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".alert--info").exists()).toBe(true);
    expect(wrapper.find(".alert__title").text()).toContain(
      "Geotagged photos from Instagram",
    );
  });

  it("hides the import alert when Instagram is not connected", () => {
    mockInstagramConnected.value = false;
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".alert--info").exists()).toBe(false);
  });

  it("dismiss button hides the import alert", async () => {
    mockInstagramConnected.value = true;
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".alert--info").exists()).toBe(true);
    await wrapper.find('[aria-label="Dismiss import alert"]').trigger("click");
    expect(wrapper.find(".alert--info").exists()).toBe(false);
  });

  it("import alert reappears after a fresh import result even if previously dismissed", async () => {
    mockInstagramConnected.value = true;
    const wrapper = mount(HomePage, globalConfig);
    // Dismiss the alert
    await wrapper.find('[aria-label="Dismiss import alert"]').trigger("click");
    expect(wrapper.find(".alert--info").exists()).toBe(false);
    // A fresh import result should un-dismiss
    mockImportResult.value = { imported: 3, skipped: 0, errors: [] };
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".alert--info").exists()).toBe(true);
    // Clean up
    mockImportResult.value = null;
  });

  it("clears the import alert when Instagram is disconnected", async () => {
    mockInstagramConnected.value = true;
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".alert--info").exists()).toBe(true);
    // Simulate disconnect
    mockInstagramConnected.value = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".alert--info").exists()).toBe(false);
  });

  it("renders the mini map card with pins from the places store", () => {
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".map-card").exists()).toBe(true);
    // Both sample places have valid lat/lon
    expect(wrapper.findAll(".pin-abs")).toHaveLength(2);
  });

  it("excludes places with null coordinates from map pins", () => {
    placesRef.value = [
      ...SAMPLE_PLACES,
      {
        id: "p-null",
        userId: "u-1",
        name: "Unknown",
        subtitle: null,
        country: null,
        latitude: null,
        longitude: null,
        category: null,
        createdAt: "2024-01-03T00:00:00.000Z",
        updatedAt: "2024-01-03T00:00:00.000Z",
      },
    ];
    const wrapper = mount(HomePage, globalConfig);
    // The null-coord place must not render a pin
    expect(wrapper.findAll(".pin-abs")).toHaveLength(2);
  });

  it("first map pin is large, subsequent pins are small", () => {
    const wrapper = mount(HomePage, globalConfig);
    const pins = wrapper.findAll(".pin-abs");
    expect(pins[0].classes()).not.toContain("sm");
    expect(pins[1].classes()).toContain("sm");
  });

  it("renders the current trip card from the trips store", () => {
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".trip-card").exists()).toBe(true);
    expect(wrapper.find(".trip-card h3").text()).toBe("Iceland, the ring road");
  });

  it("renders the progress bar reflecting done-stop ratio", () => {
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".progress").exists()).toBe(true);
    // 1 done stop out of 3 total = 33%
    expect(wrapper.find(".progress span").attributes("style")).toContain(
      "width: 33%",
    );
  });

  it("renders the next stop from trip detail", () => {
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".nextstop").exists()).toBe(true);
    expect(wrapper.find(".nextstop").text()).toContain("Jökulsárlón");
  });

  it("renders recent journal entries from the entries store", () => {
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.findAll(".entry")).toHaveLength(2);
  });

  it("renders entry titles from the entries store", () => {
    const wrapper = mount(HomePage, globalConfig);
    const titles = wrapper
      .findAll(".entry__title")
      .map((element) => element.text());
    expect(titles).toContain("Harbor at 4am");
    expect(titles).toContain("Tram 28, again");
  });

  it("resolves place name from places store for entry location", () => {
    const wrapper = mount(HomePage, globalConfig);
    const locations = wrapper
      .findAll(".entry__loc")
      .map((element) => element.text().trim());
    // e-1 has placeId "p-1" which maps to "Reykjavík"
    expect(locations[0]).toContain("Reykjavík");
  });

  it("shows no active trip message when tripList is empty", () => {
    tripListRef.value = [];
    tripDetailRef.value = null;
    const wrapper = mount(HomePage, globalConfig);
    expect(wrapper.find(".trip-card").text()).toContain(
      "No active trip right now",
    );
  });
});
