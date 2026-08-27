import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, reactive, nextTick, unref, watch } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TripDetailPage from "../trips/[id].vue";
import { useTripsStore } from "~/stores/trips";
import type { TripDetail } from "~/stores/trips";

// Override the global useRoute stub with a REACTIVE params object so a test can
// change the trip id and assert the page's watched ref tracks it.
const routeParams = reactive({ id: "trip-1" });
vi.stubGlobal("useRoute", () => ({ params: routeParams, query: {} }));

// The page derives isOwner from the signed-in Clerk user id vs the trip owner.
// Drive that from a shared ref so a test can view the trip as its owner (all
// edit controls render) or as a non-owner / anonymous visitor (read-only).
const clerkUserRef = ref<{ id: string } | null>(null);
vi.stubGlobal("useClerkUser", () => ({ user: clerkUserRef }));

// isOwner, the fetch's isClerkLoaded watch, and the not-found sign-in affordance
// all read useClerkAuth; drive them from refs so a test can simulate the Clerk
// bootstrap window, a signed-out visitor, and the owner arriving after load.
const clerkLoadedRef = ref(true);
const clerkSignedInRef = ref(false);
vi.stubGlobal("useClerkAuth", () => ({
  isLoaded: clerkLoadedRef,
  isSignedIn: clerkSignedInRef,
  getToken: vi.fn().mockResolvedValue(null),
}));

const TRIP_OWNER_ID = "user-1";

// The global useAsyncData stub never invokes its handler and returns no status,
// so the page's client-only fetch wiring is dead under test. Override it to run
// the handler once and record its options so tests can assert the trip is
// requested by its route param and that the fetch stays client-only
// (server:false). `asyncDataStatus` lets a test simulate the pre-resolution
// window the page treats as loading.
let lastAsyncDataOptions: { watch?: unknown[]; server?: boolean } | undefined;
const asyncDataStatus = ref<"idle" | "pending" | "success" | "error">(
  "success",
);
vi.stubGlobal(
  "useAsyncData",
  (
    _key: unknown,
    handler: () => unknown,
    options?: { watch?: unknown[]; server?: boolean },
  ) => {
    lastAsyncDataOptions = options;
    handler();
    // Honour the real refetch-on-watch contract so a test can assert an
    // anonymous visitor fetches once while the owner's request re-runs when the
    // session resolves — asserting the watch array alone would pass even if the
    // page dropped the watcher entirely.
    if (options?.watch) {
      watch(options.watch as Parameters<typeof watch>[0], () => {
        handler();
      });
    }
    return {
      data: ref(null),
      pending: ref(false),
      error: ref(null),
      status: asyncDataStatus,
      refresh: vi.fn(),
    };
  },
);

const SAMPLE_DETAIL: TripDetail = {
  trip: {
    id: "trip-1",
    userId: "user-1",
    name: "Iceland, the ring road",
    status: "ongoing",
    startDate: "2026-06-09T00:00:00.000Z",
    endDate: "2026-06-17T00:00:00.000Z",
    coverImageId: null,
    distanceKm: 1332,
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  stops: [
    {
      id: "stop-1",
      tripId: "trip-1",
      placeId: null,
      name: "Reykjavík",
      sortOrder: 0,
      arriveDate: "2026-06-09T00:00:00.000Z",
      nights: 2,
      note: "Landed, picked up the camper.",
      distanceKm: null,
      status: "done",
    },
    {
      id: "stop-2",
      tripId: "trip-1",
      placeId: null,
      name: "Jökulsárlón",
      sortOrder: 1,
      arriveDate: null,
      nights: null,
      note: null,
      distanceKm: 270,
      status: "next",
    },
    {
      id: "stop-3",
      tripId: "trip-1",
      placeId: null,
      name: "Höfn",
      sortOrder: 2,
      arriveDate: null,
      nights: 1,
      note: null,
      distanceKm: 180,
      status: "planned",
    },
  ],
  facts: {
    distanceKm: 1332,
    loggedDistanceKm: 450,
    nights: 3,
    photoCount: 61,
    stopCount: 3,
  },
};

function buildGlobalConfig(pinia: ReturnType<typeof createPinia>) {
  return {
    global: {
      plugins: [pinia],
      stubs: {
        AppIcon: { template: "<svg data-icon />" },
        NuxtLink: {
          template: '<a :href="to"><slot /></a>',
          props: ["to"],
        },
      },
    },
  };
}

describe("Trip Detail page (/trips/[id])", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    routeParams.id = "trip-1";
    asyncDataStatus.value = "success";
    lastAsyncDataOptions = undefined;
    // Default: Clerk resolved, viewing as the trip's owner, so the owner-only
    // controls render.
    clerkLoadedRef.value = true;
    clerkSignedInRef.value = true;
    clerkUserRef.value = { id: TRIP_OWNER_ID };
    pinia = createPinia();
    setActivePinia(pinia);

    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = { ...SAMPLE_DETAIL };
    vi.spyOn(tripsStore, "fetchTripById").mockResolvedValue();
  });

  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".thero").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the hero with trip title", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".thero h1").text()).toContain(
      "Iceland, the ring road",
    );
  });

  it("renders the itinerary stops from the store", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.findAll(".stop").length).toBe(3);
  });

  it("marks completed stops with is-done", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.findAll(".stop.is-done").length).toBeGreaterThan(0);
  });

  it("marks the next stop with is-next", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".stop.is-next").exists()).toBe(true);
  });

  it("renders stop names from the store", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.html()).toContain("Reykjavík");
    expect(wrapper.html()).toContain("Jökulsárlón");
    expect(wrapper.html()).toContain("Höfn");
  });

  it("renders the right rail with trip facts", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".trail").exists()).toBe(true);
    expect(wrapper.findAll(".fact").length).toBeGreaterThan(0);
  });

  it("renders the mini map", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".mini-map").exists()).toBe(true);
  });

  it("renders trip facts from the store", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const factValues = wrapper
      .findAll(".fact .v")
      .map((element) => element.text());
    expect(factValues).toContain("Ongoing");
    expect(factValues).toContain("61");
  });

  it("renders the companions invite section", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".companions").exists()).toBe(true);
    expect(wrapper.html()).toContain("Invite someone");
  });

  it("shows loading state when isLoadingDetail is true", async () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    tripsStore.isLoadingDetail = true;

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".loading-state").exists()).toBe(true);
    expect(wrapper.find(".thero").exists()).toBe(false);
  });

  it("shows not-found state when trip is null and not loading", () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.find(".thero").exists()).toBe(false);
  });

  it("renders add a stop button", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".add-btn").exists()).toBe(true);
  });

  it("renders edit cover and share buttons in the hero", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const buttons = wrapper.findAll(".thero__acts button");
    expect(buttons.length).toBe(2);
  });

  it("calls createStop with the route trip id when add a stop is clicked", async () => {
    const tripsStore = useTripsStore();
    vi.spyOn(tripsStore, "createStop").mockResolvedValue({
      id: "new-stop",
      tripId: "trip-1",
      placeId: null,
      name: "New stop",
      sortOrder: 3,
      arriveDate: null,
      nights: null,
      note: null,
      distanceKm: null,
      status: "planned",
    });

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    await wrapper.find(".add-btn").trigger("click");
    await wrapper.vm.$nextTick();

    expect(tripsStore.createStop).toHaveBeenCalledWith("trip-1", {
      name: "New stop",
      status: "planned",
    });
  });

  it("sorts stops by sortOrder", () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = {
      ...SAMPLE_DETAIL,
      stops: [
        { ...SAMPLE_DETAIL.stops[2], sortOrder: 2, name: "Third" },
        { ...SAMPLE_DETAIL.stops[0], sortOrder: 0, name: "First" },
        { ...SAMPLE_DETAIL.stops[1], sortOrder: 1, name: "Second" },
      ],
    };

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const stopNames = wrapper
      .findAll(".stop__name")
      .map((element) => element.text());
    expect(stopNames[0]).toBe("First");
    expect(stopNames[1]).toBe("Second");
    expect(stopNames[2]).toBe("Third");
  });

  it("requests the trip named by the route param", () => {
    const tripsStore = useTripsStore();
    mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(tripsStore.fetchTripById).toHaveBeenCalledWith("trip-1");
  });

  it("fetches client-only (server:false) so the token-bearing request never runs during SSR", () => {
    mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(lastAsyncDataOptions?.server).toBe(false);
  });

  it("watches the trip id so it refetches on in-page navigation", async () => {
    mount(TripDetailPage, buildGlobalConfig(pinia));

    // The watched source must be the trip id (not, say, the loaded trip) so the
    // component refetches when navigating between two trips.
    const watchedTripId = lastAsyncDataOptions?.watch?.[0];
    expect(unref(watchedTripId)).toBe("trip-1");

    routeParams.id = "trip-2";
    await nextTick();

    expect(unref(watchedTripId)).toBe("trip-2");
  });

  // server:false means the status is "idle" during SSR + the hydration frame and
  // "pending" while the client fetch runs; both are the pre-resolution window
  // that produced the original "Trip not found." flash, so both must read as
  // loading, never not-found, for a valid trip.
  it.each(["idle", "pending"] as const)(
    "shows loading (not the not-found state) while the client fetch is %s",
    (status) => {
      asyncDataStatus.value = status;
      const tripsStore = useTripsStore();
      tripsStore.currentTripDetail = null;
      tripsStore.isLoadingDetail = false;

      const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

      expect(wrapper.find(".loading-state").exists()).toBe(true);
      expect(wrapper.find(".empty-state").exists()).toBe(false);
    },
  );

  it("leaves the loading state once the client fetch errors (never spins forever)", () => {
    // "error" counts as resolved: a failed fetch must drop out of loading into
    // the not-found/error branch. Narrowing hasResolvedFetch to only "success"
    // would spin "Loading trip…" forever, so this case guards that boundary.
    asyncDataStatus.value = "error";
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    tripsStore.isLoadingDetail = false;

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".loading-state").exists()).toBe(false);
    expect(wrapper.find(".empty-state").exists()).toBe(true);
  });

  it("hides the hero edit/share actions from a non-owner viewer", () => {
    clerkUserRef.value = { id: "someone-else" };
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".thero__acts").exists()).toBe(false);
  });

  it("hides mutation controls (add stop, reorder, cover, invite) from an anonymous viewer", () => {
    clerkUserRef.value = null;
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".add-btn").exists()).toBe(false);
    expect(wrapper.find(".iti-head button").exists()).toBe(false);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find(".stop__grip").exists()).toBe(false);
    expect(wrapper.find(".companions").exists()).toBe(false);
  });

  it("still renders the public trip content for a non-owner (read-only)", () => {
    clerkUserRef.value = { id: "someone-else" };
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".thero h1").text()).toContain(
      "Iceland, the ring road",
    );
    expect(wrapper.findAll(".stop").length).toBe(3);
    expect(wrapper.find(".trail").exists()).toBe(true);
  });

  it("renders a public trip read-only even if Clerk never loads (script blocked)", () => {
    // isLoading must not depend on Clerk: an anonymous visitor following a
    // shared link needs nothing from Clerk, so a blocked Clerk script degrades
    // to the read-only page, never a permanent "Loading trip…".
    clerkLoadedRef.value = false;
    clerkUserRef.value = null;
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".loading-state").exists()).toBe(false);
    expect(wrapper.find(".thero h1").text()).toContain(
      "Iceland, the ring road",
    );
    expect(wrapper.find(".thero__acts").exists()).toBe(false);
  });

  it("fetches once for an anonymous visitor and retries once the owner's session resolves", async () => {
    // Start anonymous with Clerk still loading.
    clerkLoadedRef.value = false;
    clerkSignedInRef.value = false;
    const tripsStore = useTripsStore();
    const fetchSpy = tripsStore.fetchTripById as unknown as ReturnType<
      typeof vi.fn
    >;

    mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Clerk finishing its load for an anonymous visitor must NOT retry: they
    // never gain a token, so a second identical request is wasted.
    clerkLoadedRef.value = true;
    await nextTick();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A resolved, signed-in session triggers exactly one authenticated retry so
    // the owner's own private trip loads after the anonymous first pass 404'd.
    clerkSignedInRef.value = true;
    await nextTick();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    expect(lastAsyncDataOptions?.watch).toHaveLength(2);
  });

  it("offers a sign-in link in the not-found state for a signed-out visitor", () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    clerkSignedInRef.value = false;

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".empty-state__signin").exists()).toBe(true);
  });

  it("omits the sign-in link when the visitor is already signed in", () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    clerkSignedInRef.value = true;

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.find(".empty-state__signin").exists()).toBe(false);
  });

  it("does not register auth middleware so a public trip opens without login", () => {
    // definePageMeta is a compiler macro stubbed to capture its argument; the
    // page must not declare middleware: "auth" or an anonymous visitor bounces
    // to /login before the visibility-aware GET ever runs.
    const definePageMetaMock = globalThis.definePageMeta as ReturnType<
      typeof vi.fn
    >;
    definePageMetaMock.mockClear();

    mount(TripDetailPage, buildGlobalConfig(pinia));

    const meta = definePageMetaMock.mock.calls.at(-1)?.[0] as
      { middleware?: unknown; layout?: unknown } | undefined;
    // Anchor on a known key so the assertion can't pass vacuously by the macro
    // never being called.
    expect(meta).toBeDefined();
    expect(meta?.layout).toBe("app");
    expect(meta?.middleware).toBeUndefined();
  });

  it("does not render a stale trip whose id no longer matches the route", async () => {
    // With the fetch resolved (status success) and the store still holding the
    // previous trip, only the id-guard keeps the page from rendering trip-1's
    // hero under the trip-2 URL. Delete the guard and this fails.
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".thero h1").text()).toContain(
      "Iceland, the ring road",
    );

    routeParams.id = "trip-2";
    await nextTick();

    expect(wrapper.find(".thero").exists()).toBe(false);
  });
});
