import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import ExplorePage from "../explore.vue";
import type { SearchGroups } from "~/composables/useSearch";
import type {
  FeaturedTrip,
  TrendingPlace,
  DiscoverGuide,
  SuggestedPerson,
} from "~/composables/useDiscover";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const iconStub = { template: "<svg data-icon />" };
const topbarStub = {
  template: '<header class="topbar"><slot /></header>',
  props: ["title", "crumb"],
};
const linkStub = { template: "<a><slot /></a>", props: ["to"] };
// explore.vue renders <AppAlert> in error branches (discoverError, followError).
// Stub it globally so error-path tests don't emit "Failed to resolve component"
// warnings when those branches render.
const alertStub = {
  template: '<div class="alert-stub" :data-message="message" />',
  props: ["intent", "message", "dismissible"],
};

// ---------------------------------------------------------------------------
// Follow system mocks
// ---------------------------------------------------------------------------

const mockToggleFollow = vi.fn();
const mockFetchFollowing = vi.fn();
const followingIds = ref<Set<string>>(new Set());
const pendingUserIds = ref<Set<string>>(new Set());
const followError = ref<string | null>(null);

vi.stubGlobal("useFollows", () => ({
  fetchFollowing: mockFetchFollowing,
  toggleFollow: mockToggleFollow,
  isFollowing: (userId: string) => followingIds.value.has(userId),
  isPending: (userId: string) => pendingUserIds.value.has(userId),
  followingIds,
  pendingUserIds,
  error: followError,
}));

// ---------------------------------------------------------------------------
// Search mocks
// ---------------------------------------------------------------------------

vi.stubGlobal("useApiClient", () => ({ apiFetch: vi.fn() }));

const heroSearchQuery = ref("");
const heroSearchResults = ref<SearchGroups>({
  places: [],
  trips: [],
  entries: [],
  guides: [],
  people: [],
});
const mockHeroSearch = vi.fn();
vi.stubGlobal("useSearch", () => ({
  query: heroSearchQuery,
  results: heroSearchResults,
  isLoading: ref(false),
  error: ref(null),
  search: mockHeroSearch,
}));

// ---------------------------------------------------------------------------
// Discover mocks (real data)
// ---------------------------------------------------------------------------

const mockFetchAll = vi.fn();
const mockFetchTrendingPlaces = vi.fn();

const featuredTrips = ref<FeaturedTrip[]>([
  {
    id: "trip-1",
    name: "The ring road, slowly",
    status: "past",
    stopCount: 7,
    ownerHandle: "elsa_far",
    ownerDisplayName: "Elsa",
  },
  {
    id: "trip-2",
    name: "Lisbon to the Algarve",
    status: "past",
    stopCount: 5,
    ownerHandle: "marco.travels",
    ownerDisplayName: "Marco",
  },
  {
    id: "trip-3",
    name: "North to south by rail",
    status: "past",
    stopCount: 9,
    ownerHandle: "yuki",
    ownerDisplayName: "Yuki",
  },
]);

const trendingPlaces = ref<TrendingPlace[]>([
  {
    name: "Reynisfjara",
    country: "Iceland",
    category: "nature",
    saveCount: 4200,
    recentSaveCount: 180,
  },
  {
    name: "Alfama",
    country: "Portugal",
    category: "city",
    saveCount: 3700,
    recentSaveCount: 240,
  },
  {
    name: "Diamond Beach",
    country: "Iceland",
    category: "coast",
    saveCount: 2900,
    recentSaveCount: 120,
  },
  {
    name: "Tsukiji outer market",
    country: "Japan",
    category: "food",
    saveCount: 5100,
    recentSaveCount: 90,
  },
]);

const guides = ref<DiscoverGuide[]>([
  {
    id: "guide-1",
    title: "The cold-water swimming guide to Iceland",
    readTimeMinutes: 8,
    likeCount: 412,
    ownerHandle: "elsa_far",
    ownerDisplayName: "Elsa",
  },
  {
    id: "guide-2",
    title: "Lisbon on foot: a hill-by-hill walk",
    readTimeMinutes: 6,
    likeCount: 287,
    ownerHandle: "marco.travels",
    ownerDisplayName: "Marco",
  },
  {
    id: "guide-3",
    title: "Eating Tokyo for a week without a plan",
    readTimeMinutes: 11,
    likeCount: 638,
    ownerHandle: "yuki",
    ownerDisplayName: "Yuki",
  },
]);

const suggestedPeople = ref<SuggestedPerson[]>([
  {
    userId: "user_elsa",
    displayName: "Elsa Farþegi",
    handle: "elsa_far",
    homeBase: "Reykjavík",
    placeCount: 84,
  },
  {
    userId: "user_marco",
    displayName: "Marco Reis",
    handle: "marco.travels",
    homeBase: "Lisbon",
    placeCount: 2100,
  },
  {
    userId: "user_yuki",
    displayName: "Yuki Tanaka",
    handle: "yuki",
    homeBase: "Tokyo",
    placeCount: 510,
  },
  {
    userId: "user_maya",
    displayName: "Maya Rambles",
    handle: "mayarambles",
    homeBase: "Oslo",
    placeCount: 332,
  },
]);

vi.stubGlobal("useDiscover", () => ({
  featuredTrips,
  trendingPlaces,
  guides,
  suggestedPeople,
  isLoading: ref(false),
  error: ref(null),
  fetchAll: mockFetchAll,
  fetchTrendingPlaces: mockFetchTrendingPlaces,
}));

// ---------------------------------------------------------------------------
// Mount config
// ---------------------------------------------------------------------------

const globalConfig = {
  global: {
    stubs: {
      AppIcon: iconStub,
      AppTopbar: topbarStub,
      NuxtLink: linkStub,
      AppAlert: alertStub,
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Explore page (/explore)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    followingIds.value = new Set();
    pendingUserIds.value = new Set();
    followError.value = null;
    heroSearchQuery.value = "";
    heroSearchResults.value = {
      places: [],
      trips: [],
      entries: [],
      guides: [],
      people: [],
    };
  });

  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    expect(wrapper.find(".xhero").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the hero section with search input", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    expect(wrapper.find(".xhero h1").text()).toBe("Where to next?");
    expect(wrapper.find(".xsearch input").exists()).toBe(true);
  });

  it("renders the Guides group in hero search results", async () => {
    heroSearchQuery.value = "kyoto";
    heroSearchResults.value = {
      places: [],
      trips: [],
      entries: [],
      guides: [
        {
          id: "g-1",
          title: "48 hours in Kyoto",
          icon: "layers",
          href: "/guides",
        },
      ],
      people: [],
    };

    const wrapper = mount(ExplorePage, globalConfig);
    await wrapper.vm.$nextTick();

    const guidesGroup = wrapper
      .findAll(".xsearch-group")
      .find((group) => group.find(".xsearch-group__label").text() === "Guides");
    expect(guidesGroup).toBeDefined();
    expect(guidesGroup?.find(".xsearch-item__title").text()).toContain(
      "48 hours in Kyoto",
    );
  });

  it("renders 5 search chips", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    expect(wrapper.findAll(".xchip")).toHaveLength(5);
  });

  it("sets hero search value when chip is clicked", async () => {
    const wrapper = mount(ExplorePage, globalConfig);
    const chips = wrapper.findAll(".xchip");
    await chips[0].trigger("click");
    expect(
      (wrapper.find(".xsearch input").element as HTMLInputElement).value,
    ).toBe("Cold-water swims");
  });

  it("renders 3 featured destination cards from API data", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    expect(wrapper.findAll(".feat")).toHaveLength(3);
  });

  it("renders featured trip names from API", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    const titles = wrapper.findAll(".feat__title").map((el) => el.text());
    expect(titles).toContain("The ring road, slowly");
    expect(titles).toContain("Lisbon to the Algarve");
    expect(titles).toContain("North to south by rail");
  });

  it("renders 6 place filter buttons", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    expect(wrapper.findAll(".fbtn")).toHaveLength(6);
    expect(wrapper.find(".fbtn.is-active").text()).toBe("All");
  });

  it("switches active filter and calls fetchTrendingPlaces when filter clicked", async () => {
    mockFetchTrendingPlaces.mockResolvedValue(undefined);
    const wrapper = mount(ExplorePage, globalConfig);
    const filters = wrapper.findAll(".fbtn");
    await filters[1].trigger("click");
    expect(filters[1].classes()).toContain("is-active");
    expect(filters[0].classes()).not.toContain("is-active");
    expect(mockFetchTrendingPlaces).toHaveBeenCalledWith("nature");
  });

  it("renders 4 trending place cards from API data", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    expect(wrapper.findAll(".pcard")).toHaveLength(4);
  });

  it("renders place card names from API", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    const names = wrapper.findAll(".pcard__name").map((el) => el.text());
    expect(names).toContain("Reynisfjara");
    expect(names).toContain("Alfama");
  });

  it("renders 3 guide cards from API data", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    expect(wrapper.findAll(".guide")).toHaveLength(3);
  });

  it("renders guide titles from API", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    const titles = wrapper.findAll(".guide__name").map((el) => el.text());
    expect(titles).toContain("The cold-water swimming guide to Iceland");
  });

  it("renders 4 people to follow from API data", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    expect(wrapper.findAll(".person")).toHaveLength(4);
  });

  it("links each person's name to their profile route", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    const personLinks = wrapper
      .findAllComponents(linkStub)
      .filter((link) => link.classes().includes("person__name"));
    // Guards against a userId/id typo pointing every profile link at /u/undefined.
    expect(personLinks[0].props("to")).toBe("/u/user_elsa");
    expect(personLinks[1].props("to")).toBe("/u/user_marco");
  });

  it("calls fetchAll and fetchFollowing on mount", async () => {
    mount(ExplorePage, globalConfig);
    expect(mockFetchAll).toHaveBeenCalledTimes(1);
    expect(mockFetchFollowing).toHaveBeenCalledTimes(1);
  });

  it("shows a person as followed when their userId is in followingIds", async () => {
    followingIds.value = new Set(["user_elsa"]);
    const wrapper = mount(ExplorePage, globalConfig);
    const followBtns = wrapper.findAll(".person .btn");
    const followingBtn = followBtns.find((btn) =>
      btn.classes().includes("btn--primary"),
    );
    expect(followingBtn).toBeTruthy();
    expect(followingBtn?.text()).toContain("following");
  });

  it("shows no one followed when followingIds is empty", () => {
    const wrapper = mount(ExplorePage, globalConfig);
    const followBtns = wrapper.findAll(".person .btn");
    const followingBtn = followBtns.find((btn) =>
      btn.classes().includes("btn--primary"),
    );
    expect(followingBtn).toBeUndefined();
  });

  it("calls toggleFollow with the correct userId when follow button is clicked", async () => {
    mockToggleFollow.mockResolvedValue(undefined);
    const wrapper = mount(ExplorePage, globalConfig);
    const firstFollowBtn = wrapper.findAll(".person .btn")[0];
    await firstFollowBtn.trigger("click");
    expect(mockToggleFollow).toHaveBeenCalledWith("user_elsa");
  });

  it("reflects updated follow state after toggleFollow resolves", async () => {
    mockToggleFollow.mockImplementation(async (userId: string) => {
      followingIds.value = new Set([...followingIds.value, userId]);
    });
    const wrapper = mount(ExplorePage, globalConfig);
    const firstFollowBtn = wrapper.findAll(".person .btn")[0];
    await firstFollowBtn.trigger("click");
    await wrapper.vm.$nextTick();
    expect(firstFollowBtn.classes()).toContain("btn--primary");
    expect(firstFollowBtn.text()).toContain("following");
  });

  it("disables a follow button while its toggle is pending", async () => {
    pendingUserIds.value = new Set(["user_elsa"]);
    const wrapper = mount(ExplorePage, globalConfig);
    const firstFollowBtn = wrapper.findAll(".person .btn")[0];
    expect((firstFollowBtn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an error alert when followError is set", async () => {
    followError.value = "Could not update follow state";
    const wrapper = mount(ExplorePage, {
      global: {
        stubs: {
          AppIcon: iconStub,
          AppTopbar: topbarStub,
          NuxtLink: linkStub,
          AppAlert: alertStub,
        },
      },
    });
    expect(wrapper.find(".alert-stub").exists()).toBe(true);
    expect(wrapper.find(".alert-stub").attributes("data-message")).toBe(
      "Could not update follow state",
    );
  });

  it("renders 'by a traveler' when guide has no handle and no displayName", () => {
    const sparsePeople = ref<SuggestedPerson[]>([]);
    const sparseGuides = ref<DiscoverGuide[]>([
      {
        id: "guide-anon",
        title: "Anonymous guide",
        readTimeMinutes: 4,
        likeCount: 0,
        ownerHandle: null,
        ownerDisplayName: null,
      },
    ]);
    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides: sparseGuides,
      suggestedPeople: sparsePeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));

    const wrapper = mount(ExplorePage, globalConfig);
    const byLines = wrapper.findAll(".guide__by");
    expect(byLines[0].text()).toBe("by a traveler");

    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));
  });

  it("renders displayName fallback when guide has no handle but has displayName", () => {
    const sparseGuides = ref<DiscoverGuide[]>([
      {
        id: "guide-nohandle",
        title: "Guide with only display name",
        readTimeMinutes: 5,
        likeCount: 20,
        ownerHandle: null,
        ownerDisplayName: "No Handle Person",
      },
    ]);
    const sparsePeople = ref<SuggestedPerson[]>([]);
    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides: sparseGuides,
      suggestedPeople: sparsePeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));

    const wrapper = mount(ExplorePage, globalConfig);
    const byLines = wrapper.findAll(".guide__by");
    expect(byLines[0].text()).toBe("by No Handle Person");

    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));
  });

  it("renders 'Wanderist traveler' fallback when person has no displayName or handle", () => {
    const sparsePeople = ref<SuggestedPerson[]>([
      {
        userId: "user_anon",
        displayName: null,
        handle: null,
        homeBase: null,
        placeCount: 0,
      },
    ]);
    const sparseGuides = ref<DiscoverGuide[]>([]);
    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides: sparseGuides,
      suggestedPeople: sparsePeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));

    const wrapper = mount(ExplorePage, globalConfig);
    const nameEls = wrapper.findAll(".person__name b");
    expect(nameEls[0].text()).toBe("Wanderist traveler");

    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));
  });

  it("omits placeCount from personSubline when count is zero", () => {
    const sparsePeople = ref<SuggestedPerson[]>([
      {
        userId: "user_newbie",
        displayName: "Newbie",
        handle: "newbie",
        homeBase: "Berlin",
        placeCount: 0,
      },
    ]);
    const sparseGuides = ref<DiscoverGuide[]>([]);
    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides: sparseGuides,
      suggestedPeople: sparsePeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));

    const wrapper = mount(ExplorePage, globalConfig);
    const sublines = wrapper.findAll(".person__name span");
    expect(sublines[0].text()).not.toContain("places");
    expect(sublines[0].text()).toContain("newbie");

    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));
  });

  it("formats save count as Nk when count is >= 1000", () => {
    const highSavePlaces = ref<TrendingPlace[]>([
      {
        name: "Popular spot",
        country: "France",
        category: "city",
        saveCount: 4200,
        recentSaveCount: 0,
      },
    ]);
    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces: highSavePlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));

    const wrapper = mount(ExplorePage, globalConfig);
    const savesEl = wrapper.find(".saves");
    expect(savesEl.text()).toContain("4.2k");

    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));
  });

  it("formats save count as plain number when count is < 1000", () => {
    const lowSavePlaces = ref<TrendingPlace[]>([
      {
        name: "Small spot",
        country: "Norway",
        category: "nature",
        saveCount: 42,
        recentSaveCount: 0,
      },
    ]);
    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces: lowSavePlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));

    const wrapper = mount(ExplorePage, globalConfig);
    const savesEl = wrapper.find(".saves");
    expect(savesEl.text()).toContain("42");
    expect(savesEl.text()).not.toContain("k");

    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));
  });

  it("shows a discover error alert when discoverError is set", () => {
    const discoverError = ref<string | null>(
      "Could not load discovery content",
    );
    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: discoverError,
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));

    const wrapper = mount(ExplorePage, {
      global: {
        stubs: {
          AppIcon: iconStub,
          AppTopbar: topbarStub,
          NuxtLink: linkStub,
          AppAlert: alertStub,
        },
      },
    });
    const alert = wrapper.find(".alert-stub");
    expect(alert.exists()).toBe(true);
    expect(alert.attributes("data-message")).toBe(
      "Could not load discovery content",
    );

    // Restore mock for subsequent tests
    vi.stubGlobal("useDiscover", () => ({
      featuredTrips,
      trendingPlaces,
      guides,
      suggestedPeople,
      isLoading: ref(false),
      error: ref(null),
      fetchAll: mockFetchAll,
      fetchTrendingPlaces: mockFetchTrendingPlaces,
    }));
  });
});
