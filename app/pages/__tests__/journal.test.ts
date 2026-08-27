import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import JournalPage from "../journal.vue";
import { useEntriesStore } from "~/stores/entries";
import { useTripsStore } from "~/stores/trips";
import type { Entry } from "~/stores/entries";
import type { Trip } from "~/stores/trips";

const SAMPLE_ENTRIES: Entry[] = [
  {
    id: "entry-1",
    userId: "user-1",
    tripId: "trip-1",
    placeId: null,
    title: "Harbor at 4am",
    body: "Cold morning, the whole harbor still asleep.",
    occurredAt: "2026-06-12T04:12:00.000Z",
    visibility: "private",
    weather: null,
    likeCount: 24,
    createdAt: "2026-06-12T04:12:00.000Z",
    updatedAt: "2026-06-12T04:12:00.000Z",
    photos: [],
    tags: [{ id: "tag-1", name: "iceland" }],
  },
  {
    id: "entry-2",
    userId: "user-1",
    tripId: null,
    placeId: null,
    title: "Tram 28, again",
    body: "Took the long way through Alfama.",
    occurredAt: "2026-06-08T18:40:00.000Z",
    visibility: "private",
    weather: null,
    likeCount: 41,
    createdAt: "2026-06-08T18:40:00.000Z",
    updatedAt: "2026-06-08T18:40:00.000Z",
    photos: [],
    tags: [{ id: "tag-2", name: "portugal" }],
  },
];

const SAMPLE_TRIPS: Trip[] = [
  {
    id: "trip-1",
    userId: "user-1",
    name: "Iceland, the ring road",
    status: "ongoing",
    startDate: "2026-06-07T00:00:00.000Z",
    endDate: "2026-06-16T00:00:00.000Z",
    coverImageId: null,
    distanceKm: 892,
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "trip-2",
    userId: "user-1",
    name: "Portugal 2026",
    status: "past",
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: "2026-06-10T00:00:00.000Z",
    coverImageId: null,
    distanceKm: null,
    visibility: "private",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
];

function buildGlobalConfig(pinia: ReturnType<typeof createPinia>) {
  return {
    global: {
      plugins: [pinia],
      stubs: {
        AppIcon: { template: "<svg data-icon />" },
        AppTopbar: {
          template: '<header class="topbar"><slot /></header>',
          props: ["title", "crumb"],
        },
        NuxtLink: {
          template: '<a :href="to"><slot /></a>',
          props: ["to"],
        },
        JournalEntry: {
          template:
            '<article class="post"><h3 class="post__title">{{ entry.title }}</h3><button class="like" :class="{ liked: isLiked }" @click="$emit(\'toggle-like\', entry)"><span class="cnt">{{ entry.likeCount }}</span></button></article>',
          props: ["entry", "isLiked"],
          emits: ["toggle-like"],
        },
      },
    },
  };
}

describe("Journal page (/journal)", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    const entriesStore = useEntriesStore();
    entriesStore.entries = [...SAMPLE_ENTRIES];
    vi.spyOn(entriesStore, "fetchEntries").mockResolvedValue();
    vi.spyOn(entriesStore, "likeEntry").mockResolvedValue({
      ...SAMPLE_ENTRIES[0],
      likeCount: 25,
    });
    vi.spyOn(entriesStore, "unlikeEntry").mockResolvedValue({
      ...SAMPLE_ENTRIES[0],
      likeCount: 23,
    });

    const tripsStore = useTripsStore();
    tripsStore.tripList = [...SAMPLE_TRIPS];
    vi.spyOn(tripsStore, "fetchTrips").mockResolvedValue();
  });

  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".feed").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders 3 feed tabs", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    expect(wrapper.findAll(".feed-tabs button")).toHaveLength(3);
    expect(wrapper.find(".feed-tabs button.is-active").text()).toBe("Timeline");
  });

  it("switches active tab when clicked", async () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    const tabs = wrapper.findAll(".feed-tabs button");
    await tabs[1].trigger("click");
    expect(tabs[1].classes()).toContain("is-active");
    expect(tabs[0].classes()).not.toContain("is-active");
  });

  it("renders the compose bar", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".compose").exists()).toBe(true);
    expect(wrapper.find(".compose input").exists()).toBe(true);
  });

  it("renders day dividers for timeline tab", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    // Two entries on different days → two day dividers
    expect(wrapper.findAll(".day-div")).toHaveLength(2);
  });

  it("renders post cards for each entry", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    expect(wrapper.findAll(".post")).toHaveLength(SAMPLE_ENTRIES.length);
  });

  it("renders entry titles from the store", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    const titles = wrapper.findAll(".post__title").map((el) => el.text());
    expect(titles).toContain("Harbor at 4am");
    expect(titles).toContain("Tram 28, again");
  });

  it("renders likeCount from the store", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    const counts = wrapper.findAll(".cnt").map((el) => el.text());
    expect(counts).toContain("24");
    expect(counts).toContain("41");
  });

  it("calls likeEntry on the store when like is toggled on an unliked entry", async () => {
    const entriesStore = useEntriesStore();
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    const likeBtn = wrapper.findAll(".like")[0];
    await likeBtn.trigger("click");
    expect(entriesStore.likeEntry).toHaveBeenCalledWith(SAMPLE_ENTRIES[0].id);
  });

  it("calls unlikeEntry on the store when like is toggled on an already-liked entry", async () => {
    const entriesStore = useEntriesStore();
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    // First click likes it
    const likeBtn = wrapper.findAll(".like")[0];
    await likeBtn.trigger("click");
    // Second click unlikes it
    await likeBtn.trigger("click");
    expect(entriesStore.unlikeEntry).toHaveBeenCalledWith(SAMPLE_ENTRIES[0].id);
  });

  it("renders the right rail with active trip card", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".rail").exists()).toBe(true);
    expect(wrapper.find(".rail-card .display").text()).toContain("Active trip");
  });

  it("shows the active trip name in the rail card", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".rail").html()).toContain("Iceland, the ring road");
  });

  it("renders trip pills from the trips store", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    expect(wrapper.findAll(".trip-pill")).toHaveLength(SAMPLE_TRIPS.length);
  });

  it("hides on-this-day block when there are no matching entries", () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    // onThisDayEntries starts empty; the API call on mount is not awaited in this sync test
    expect(wrapper.find(".onthisday").exists()).toBe(false);
  });

  it("renders By trip groups when By trip tab is active", async () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    const tabs = wrapper.findAll(".feed-tabs button");
    await tabs[1].trigger("click");
    const dayDivs = wrapper.findAll(".day-div");
    // entry-1 belongs to trip-1; entry-2 has no trip → "No trip"
    expect(dayDivs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Photos tab with empty state when no photos", async () => {
    const wrapper = mount(JournalPage, buildGlobalConfig(pinia));
    const tabs = wrapper.findAll(".feed-tabs button");
    await tabs[2].trigger("click");
    expect(wrapper.find(".photo-grid").exists()).toBe(false);
    expect(wrapper.html()).toContain("no photos yet");
  });

  it("calls fetchEntries on mount", async () => {
    const entriesStore = useEntriesStore();
    mount(JournalPage, buildGlobalConfig(pinia));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(entriesStore.fetchEntries).toHaveBeenCalledTimes(1);
  });

  it("calls fetchTrips on mount", async () => {
    const tripsStore = useTripsStore();
    mount(JournalPage, buildGlobalConfig(pinia));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tripsStore.fetchTrips).toHaveBeenCalledTimes(1);
  });
});
