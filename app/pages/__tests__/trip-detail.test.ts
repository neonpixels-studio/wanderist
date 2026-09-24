import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, reactive, nextTick, unref, watch } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TripDetailPage from "../trips/[id].vue";
import { useTripsStore } from "~/stores/trips";
import type { TripDetail, TripStop } from "~/stores/trips";
import { CLERK_BOOTSTRAP_TIMEOUT_MS } from "~/composables/useClerkGatedFetch";
import {
  lastSeoMetaCall,
  stubOgMetaGlobals,
} from "~/composables/__tests__/ogMetaTestUtils";
import { INVITE_UNAVAILABLE_TITLE } from "~/constants/trips";
import { UNEXPECTED_ERROR_MESSAGE } from "~/utils/extractErrorMessage";

// Override the global useRoute stub with a REACTIVE params object so a test can
// change the trip id and assert the page's watched ref tracks it. `path` is a
// getter (not a static string) so useOgMeta's og:url reflects a route-param
// change, not just the value at mount.
const routeParams = reactive({ id: "trip-1" });
vi.stubGlobal("useRoute", () => ({
  params: routeParams,
  query: {},
  get path() {
    return `/trips/${routeParams.id}`;
  },
}));

// #269 og/twitter meta coverage below reads this trackable useSeoMeta stub.
const useSeoMetaMock = stubOgMetaGlobals();

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
const mockRefresh = vi.fn().mockResolvedValue(undefined);
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
      refresh: mockRefresh,
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

const alertStub = {
  props: ["intent", "message"],
  template: '<div class="alert-stub" :data-message="message" />',
};

// Stands in for the real store action: mirrors the actual reorderStops
// behavior (recompute sortOrder from index in the caller's list, write the
// result back onto currentTripDetail.stops, return it) so drag/keyboard
// reorder tests can assert on the resulting render without hitting the network.
function mockReorderStops(
  tripsStore: ReturnType<typeof useTripsStore>,
): ReturnType<typeof vi.fn> {
  return vi
    .spyOn(tripsStore, "reorderStops")
    .mockImplementation(async (tripId: string, stopIds: string[]) => {
      const currentDetail = tripsStore.currentTripDetail;
      if (!currentDetail || currentDetail.trip.id !== tripId) {
        return [];
      }

      const stopsById = new Map(
        currentDetail.stops.map((stop) => [stop.id, stop]),
      );
      const reordered: TripStop[] = stopIds.map((stopId, index) => ({
        ...stopsById.get(stopId)!,
        sortOrder: index,
      }));

      tripsStore.currentTripDetail = { ...currentDetail, stops: reordered };
      return reordered;
    }) as unknown as ReturnType<typeof vi.fn>;
}

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
        AppAlert: alertStub,
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
    mockRefresh.mockClear();
    useSeoMetaMock.mockClear();
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

  it("disables the invite button and row with a not-available tooltip instead of silently no-opping", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    const inviteButton = wrapper
      .findAll("button.label--plain")
      .find((button) => button.text().startsWith("invite"));
    expect(inviteButton).toBeDefined();
    expect(inviteButton!.attributes("disabled")).toBeDefined();
    // No `title` attribute here: a disabled button never fires hover/focus
    // events, so a title-only tooltip would never reach anyone. The reason
    // must be real (screen-reader reachable) text instead — asserting both
    // `title` and this text would double-announce it to AT users.
    expect(inviteButton!.attributes("title")).toBeUndefined();
    expect(inviteButton!.text()).toContain(INVITE_UNAVAILABLE_TITLE);

    const companionRow = wrapper.find(".companion--disabled");
    expect(companionRow.exists()).toBe(true);
    expect(companionRow.attributes("title")).toBe(INVITE_UNAVAILABLE_TITLE);
    expect(companionRow.text()).toContain("coming soon");
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

  it("shows not-found (not a retry prompt) for a 404, so a private/missing trip stays protected", () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    tripsStore.detailNotFound = true;
    tripsStore.detailError = null;

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.text()).toContain("Trip not found");
    expect(wrapper.find(".alert-stub").exists()).toBe(false);
  });

  it("shows a retryable error state (not 'Trip not found') on a 5xx/network failure", () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    tripsStore.detailNotFound = false;
    tripsStore.detailError = "Something went wrong loading this trip";

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.text()).not.toContain("Trip not found");
    expect(wrapper.find(".alert-stub").attributes("data-message")).toBe(
      "Something went wrong loading this trip",
    );
    expect(wrapper.text()).toContain("try again");
  });

  it("retries the fetch when 'try again' is clicked on the error state", async () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    tripsStore.detailNotFound = false;
    tripsStore.detailError = "Something went wrong loading this trip";

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    await wrapper.find("button").trigger("click");

    expect(mockRefresh).toHaveBeenCalled();
  });

  it("offers a sign-in link in the retryable error state too, so a signed-out visitor isn't stranded", () => {
    // A retry that keeps failing (e.g. an expired session on a private trip)
    // must not be the visitor's only way forward.
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    tripsStore.detailNotFound = false;
    tripsStore.detailError = "Something went wrong loading this trip";
    clerkSignedInRef.value = false;

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".empty-state__signin").exists()).toBe(true);
  });

  it("always offers a 'back to your trips' link in the retryable error state, even when signed in", () => {
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    tripsStore.detailNotFound = false;
    tripsStore.detailError = "Something went wrong loading this trip";
    clerkSignedInRef.value = true;

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".empty-state__back").exists()).toBe(true);
    expect(wrapper.find(".empty-state__signin").exists()).toBe(false);
  });

  it("keeps showing the trip and surfaces a non-blocking banner when a background refetch fails", () => {
    // Regression guard for the preserve-on-same-id-failure store behavior:
    // the content must still render, with the failure visible, not silent.
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = { ...SAMPLE_DETAIL };
    tripsStore.detailError = "Something went wrong loading this trip";

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".thero h1").text()).toContain(
      "Iceland, the ring road",
    );
    expect(wrapper.text()).toContain(
      "Couldn't refresh this trip: Something went wrong loading this trip",
    );
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

  it("renders a move up/down button per owned stop, disabled at the list boundaries", () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");

    expect(moveButtons).toHaveLength(6);
    expect(moveButtons[0]?.attributes("disabled")).toBeDefined(); // first stop, move up
    expect(moveButtons[1]?.attributes("disabled")).toBeUndefined(); // first stop, move down
    expect(moveButtons[4]?.attributes("disabled")).toBeUndefined(); // last stop, move up
    expect(moveButtons[5]?.attributes("disabled")).toBeDefined(); // last stop, move down
  });

  it("moves a stop down via the keyboard-accessible button and persists via reorderStops", async () => {
    const tripsStore = useTripsStore();
    const reorderSpy = mockReorderStops(tripsStore);

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click"); // stop-1's move-down button
    await flushPromises();

    expect(reorderSpy).toHaveBeenCalledWith("trip-1", [
      "stop-2",
      "stop-1",
      "stop-3",
    ]);
    const stopNames = wrapper
      .findAll(".stop__name")
      .map((element) => element.text());
    expect(stopNames).toEqual(["Jökulsárlón", "Reykjavík", "Höfn"]);
  });

  it("moves a stop up via the keyboard-accessible button and persists via reorderStops", async () => {
    const tripsStore = useTripsStore();
    const reorderSpy = mockReorderStops(tripsStore);

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[2]!.trigger("click"); // stop-2's move-up button
    await flushPromises();

    expect(reorderSpy).toHaveBeenCalledWith("trip-1", [
      "stop-2",
      "stop-1",
      "stop-3",
    ]);
  });

  it("reorders via drag-and-drop, dropping the dragged stop just before the target", async () => {
    // Dropping stop-3 onto stop-1 inserts it immediately before stop-1 (the
    // same semantics as moveIdToDropTarget), producing [stop-3, stop-1, stop-2].
    const tripsStore = useTripsStore();
    const reorderSpy = mockReorderStops(tripsStore);

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const stops = wrapper.findAll(".stop");
    await stops[2]!.trigger("dragstart");
    await stops[0]!.trigger("dragover");
    await stops[0]!.trigger("drop");
    await flushPromises();

    expect(reorderSpy).toHaveBeenCalledWith("trip-1", [
      "stop-3",
      "stop-1",
      "stop-2",
    ]);
    const stopNames = wrapper
      .findAll(".stop__name")
      .map((element) => element.text());
    expect(stopNames).toEqual(["Höfn", "Reykjavík", "Jökulsárlón"]);
  });

  it("is a no-op when a stop is dropped on itself", async () => {
    const tripsStore = useTripsStore();
    const reorderSpy = mockReorderStops(tripsStore);

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const stops = wrapper.findAll(".stop");
    await stops[0]!.trigger("dragstart");
    await stops[0]!.trigger("drop");
    await flushPromises();

    expect(reorderSpy).not.toHaveBeenCalled();
  });

  it("marks the dragged row and the current drop target while a drag is in progress", async () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const stops = wrapper.findAll(".stop");

    await stops[0]!.trigger("dragstart");
    expect(stops[0]!.classes()).toContain("stop--dragging");

    await stops[2]!.trigger("dragover");
    expect(stops[2]!.classes()).toContain("stop--drag-over");
    // The dragged row itself is never also marked as a drop target.
    expect(stops[0]!.classes()).not.toContain("stop--drag-over");
  });

  it("keeps the drop-target outline while the pointer moves within the same row's children", async () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const stops = wrapper.findAll(".stop");

    await stops[0]!.trigger("dragstart");
    await stops[2]!.trigger("dragover");
    expect(stops[2]!.classes()).toContain("stop--drag-over");

    // dragleave fires when the pointer crosses into a descendant (e.g. the
    // card); relatedTarget still points inside stops[2], so the outline must
    // survive rather than flicker off.
    const childElement = stops[2]!.find(".stop__card").element;
    await stops[2]!.trigger("dragleave", { relatedTarget: childElement });
    expect(stops[2]!.classes()).toContain("stop--drag-over");
  });

  it("clears the drag-over outline once the pointer truly leaves the row", async () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const stops = wrapper.findAll(".stop");

    await stops[0]!.trigger("dragstart");
    await stops[2]!.trigger("dragover");
    expect(stops[2]!.classes()).toContain("stop--drag-over");

    await stops[2]!.trigger("dragleave", { relatedTarget: document.body });
    expect(stops[2]!.classes()).not.toContain("stop--drag-over");
  });

  it("clears both drag classes when the drag ends without a drop", async () => {
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const stops = wrapper.findAll(".stop");

    await stops[0]!.trigger("dragstart");
    await stops[2]!.trigger("dragover");
    await stops[0]!.trigger("dragend");

    expect(stops[0]!.classes()).not.toContain("stop--dragging");
    expect(stops[2]!.classes()).not.toContain("stop--drag-over");
  });

  it("surfaces an error and leaves the order unchanged when reordering fails", async () => {
    const tripsStore = useTripsStore();
    vi.spyOn(tripsStore, "reorderStops").mockRejectedValue(
      new Error("Failed to save the new stop order"),
    );

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click");
    await flushPromises();

    // Regression guard: a raw Error's `.message` is diagnostic text, not
    // something the server deliberately chose to surface, so it must not
    // reach the user-facing banner — the generic fallback shows instead
    // (see app/utils/extractErrorMessage.ts). Scoped to data-test="reorder-error"
    // (rather than the whole page's text) since the add-stop banner right
    // above it shares the same alert--error class and could coincidentally
    // satisfy a page-wide match.
    expect(wrapper.find('[data-test="reorder-error"]').text()).not.toContain(
      "Failed to save the new stop order",
    );
    expect(wrapper.find('[data-test="reorder-error"]').text()).toBe(
      UNEXPECTED_ERROR_MESSAGE,
    );
    const stopNames = wrapper
      .findAll(".stop__name")
      .map((element) => element.text());
    expect(stopNames).toEqual(["Reykjavík", "Jökulsárlón", "Höfn"]);
  });

  it("announces a failed reorder in the live region (not just the visual error banner)", async () => {
    const tripsStore = useTripsStore();
    vi.spyOn(tripsStore, "reorderStops").mockRejectedValue(
      new Error("Failed to save the new stop order"),
    );

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click");
    await flushPromises();

    const liveRegion = wrapper.find('[role="status"]');
    expect(liveRegion.text()).toContain("Reykjavík");
    expect(liveRegion.text().toLowerCase()).toContain("not changed");
  });

  it("announces the new position in the live region on a successful reorder", async () => {
    const tripsStore = useTripsStore();
    mockReorderStops(tripsStore);

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click"); // stop-1's move-down button
    await flushPromises();

    const liveRegion = wrapper.find('[role="status"]');
    expect(liveRegion.text()).toBe("Moved Reykjavík to position 2 of 3");
  });

  it("ignores a second move while the first reorder is still in flight", async () => {
    const tripsStore = useTripsStore();
    let resolveReorder: ((stops: TripStop[]) => void) | undefined;
    vi.spyOn(tripsStore, "reorderStops").mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click"); // stop-1 down: request 1 in flight
    await moveButtons[3]!.trigger("click"); // stop-2 down: should be dropped

    expect(tripsStore.reorderStops).toHaveBeenCalledTimes(1);

    resolveReorder?.(SAMPLE_DETAIL.stops);
    await flushPromises();
  });

  it("announces the refusal (not silence) when a move is dropped because a reorder is already in flight", async () => {
    const tripsStore = useTripsStore();
    let resolveReorder: ((stops: TripStop[]) => void) | undefined;
    vi.spyOn(tripsStore, "reorderStops").mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click"); // stop-1 down: request 1 in flight
    await moveButtons[3]!.trigger("click"); // stop-2 down: refused

    const liveRegion = wrapper.find('[role="status"]');
    expect(liveRegion.text()).toContain("Jökulsárlón");
    expect(liveRegion.text().toLowerCase()).toContain("still saving");

    resolveReorder?.(SAMPLE_DETAIL.stops);
    await flushPromises();
  });

  it("falls back to the committed order if a pending stop id no longer resolves mid-flight", async () => {
    // Simulates a stop being deleted (by this tab or another) while a
    // reorder PUT for the old id set is still in flight — pendingStopOrder
    // would otherwise reference an id tripDetail.stops no longer has.
    const tripsStore = useTripsStore();
    let resolveReorder: ((stops: TripStop[]) => void) | undefined;
    vi.spyOn(tripsStore, "reorderStops").mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click"); // stop-1 down: now pending

    tripsStore.currentTripDetail = {
      ...SAMPLE_DETAIL,
      stops: SAMPLE_DETAIL.stops.filter((stop) => stop.id !== "stop-1"),
    };
    await nextTick();

    const stopNames = wrapper
      .findAll(".stop__name")
      .map((element) => element.text());
    expect(stopNames).toEqual(["Jökulsárlón", "Höfn"]);

    resolveReorder?.(SAMPLE_DETAIL.stops);
    await flushPromises();
  });

  it("discards an in-flight reorder's pending state when navigating to a different trip", async () => {
    const tripsStore = useTripsStore();
    let resolveReorder: ((stops: TripStop[]) => void) | undefined;
    vi.spyOn(tripsStore, "reorderStops").mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click"); // trip-1's stop-1 down: pending

    routeParams.id = "trip-2";
    await nextTick();

    // The old trip's request resolving afterward must not resurrect any
    // banner/announcement or reorder state once the same trip is shown again.
    resolveReorder?.(SAMPLE_DETAIL.stops);
    await flushPromises();

    routeParams.id = "trip-1";
    await nextTick();

    expect(wrapper.find(".alert--error").exists()).toBe(false);
    const liveRegion = wrapper.find('[role="status"]');
    expect(liveRegion.exists() ? liveRegion.text() : "").toBe("");
  });

  it("disables drag on every row while a reorder is in flight", async () => {
    const tripsStore = useTripsStore();
    vi.spyOn(tripsStore, "reorderStops").mockReturnValue(new Promise(() => {}));

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    const moveButtons = wrapper.findAll(".stop__move-btn");
    await moveButtons[1]!.trigger("click"); // stop-1 down: reorder now pending

    const stops = wrapper.findAll(".stop");
    for (const stop of stops) {
      expect(stop.attributes("draggable")).toBe("false");
    }
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
    expect(wrapper.find(".stop__move-btn").exists()).toBe(false);
    expect(wrapper.find(".stop").attributes("draggable")).toBe("false");
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
    // isLoading itself must not depend on Clerk: this test seeds the store and
    // the mocked fetch status directly (both decoupled here from whether the
    // real fetch ever fired — see "still fetches a public trip anonymously"
    // below for a test that exercises the real gate/timeout instead of the
    // mocked fetch status).
    clerkLoadedRef.value = false;
    clerkUserRef.value = null;
    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".loading-state").exists()).toBe(false);
    expect(wrapper.find(".thero h1").text()).toContain(
      "Iceland, the ring road",
    );
    expect(wrapper.find(".thero__acts").exists()).toBe(false);
  });

  // Regression coverage for the pre-existing "public content loads even if
  // Clerk is blocked" guarantee: the #255 gate withholds the fetch, but only
  // up to CLERK_BOOTSTRAP_TIMEOUT_MS (see useClerkGatedFetch).
  it("still fetches a public trip anonymously once the Clerk bootstrap grace period lapses", async () => {
    vi.useFakeTimers();
    try {
      clerkLoadedRef.value = false;
      clerkSignedInRef.value = false;
      const tripsStore = useTripsStore();
      const fetchSpy = tripsStore.fetchTripById as unknown as ReturnType<
        typeof vi.fn
      >;

      mount(TripDetailPage, buildGlobalConfig(pinia));
      expect(fetchSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression coverage for #255: the anonymous-then-retry race that used to
  // flash "Trip not found" for a signed-in owner on a hard refresh.
  it("does not fetch until Clerk resolves, then fetches exactly once already authenticated for a signed-in owner (no anonymous-then-retry flash)", async () => {
    clerkLoadedRef.value = false;
    clerkSignedInRef.value = false;
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    const fetchSpy = tripsStore.fetchTripById as unknown as ReturnType<
      typeof vi.fn
    >;
    fetchSpy.mockImplementation(async () => {
      tripsStore.currentTripDetail = { ...SAMPLE_DETAIL };
    });

    const wrapper = mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(fetchSpy).not.toHaveBeenCalled();

    // Clerk resolves isLoaded and isSignedIn together (see the production
    // comment above fetchTripDetail), so both flip in the same tick here.
    clerkSignedInRef.value = true;
    clerkLoadedRef.value = true;
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".empty-state").exists()).toBe(false);
    expect(wrapper.find(".thero h1").text()).toContain(
      "Iceland, the ring road",
    );
  });

  it("fetches exactly once for an anonymous visitor once Clerk resolves to signed-out", async () => {
    clerkLoadedRef.value = false;
    clerkSignedInRef.value = false;
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    const fetchSpy = tripsStore.fetchTripById as unknown as ReturnType<
      typeof vi.fn
    >;

    mount(TripDetailPage, buildGlobalConfig(pinia));
    expect(fetchSpy).not.toHaveBeenCalled();

    clerkLoadedRef.value = true;
    await nextTick();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Nothing about the viewer's ability to carry a token changes afterward,
    // so canRetryAuthenticated never flips and no second request fires.
    await nextTick();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries once a viewer signs in after Clerk already resolved signed-out", async () => {
    // Distinct from the hard-refresh race above: here Clerk has already
    // finished loading (e.g. the visitor signs in from this same page), so
    // canRetryAuthenticated is what drives the retry, exactly as before.
    clerkLoadedRef.value = true;
    clerkSignedInRef.value = false;
    const tripsStore = useTripsStore();
    tripsStore.currentTripDetail = null;
    const fetchSpy = tripsStore.fetchTripById as unknown as ReturnType<
      typeof vi.fn
    >;

    mount(TripDetailPage, buildGlobalConfig(pinia));
    await nextTick();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockImplementationOnce(async () => {
      tripsStore.currentTripDetail = { ...SAMPLE_DETAIL };
    });
    clerkSignedInRef.value = true;
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

  describe("Open Graph / Twitter meta (#269)", () => {
    it("emits og/twitter tags built from the loaded trip's facts, falling back to the small-card favicon when the trip has no cover", () => {
      const tripsStore = useTripsStore();
      tripsStore.currentTripDetail = { ...SAMPLE_DETAIL };

      mount(TripDetailPage, buildGlobalConfig(pinia));

      const meta = lastSeoMetaCall(useSeoMetaMock);
      const title = meta.title as () => string;
      const description = meta.description as () => string;
      const ogImage = meta.ogImage as () => string;
      const ogUrl = meta.ogUrl as () => string;

      expect(title()).toBe("Wanderist — Iceland, the ring road");
      expect((meta.ogTitle as () => string)()).toBe(title());
      expect((meta.twitterTitle as () => string)()).toBe(title());
      expect(description()).toBe(
        "Ongoing trip with 3 stops, 1,332 km on Wanderist.",
      );
      expect((meta.ogDescription as () => string)()).toBe(description());
      expect((meta.twitterDescription as () => string)()).toBe(description());
      expect(ogImage()).toBe("https://wanderist.test/favicon.ico");
      expect((meta.twitterImage as () => string)()).toBe(ogImage());
      expect(ogUrl()).toBe("https://wanderist.test/trips/trip-1");
      expect(meta.ogType).toBe("website");
      expect((meta.twitterCard as () => string)()).toBe("summary");
    });

    it("builds an absolute og:image from the trip's real cover, not the optimistic upload preview, and uses the large-image card", () => {
      const tripsStore = useTripsStore();
      tripsStore.currentTripDetail = {
        ...SAMPLE_DETAIL,
        trip: { ...SAMPLE_DETAIL.trip, coverImageId: "media-abc123" },
      };

      mount(TripDetailPage, buildGlobalConfig(pinia));

      const meta = lastSeoMetaCall(useSeoMetaMock);
      const ogImage = meta.ogImage as () => string;
      expect(ogImage()).toBe("https://wanderist.test/api/media/media-abc123");
      expect((meta.twitterCard as () => string)()).toBe("summary_large_image");
    });

    it("falls back to a placeholder title/description before a trip has loaded", () => {
      const tripsStore = useTripsStore();
      tripsStore.currentTripDetail = null;

      mount(TripDetailPage, buildGlobalConfig(pinia));

      const meta = lastSeoMetaCall(useSeoMetaMock);
      expect((meta.title as () => string)()).toBe("Wanderist — Trip");
      expect((meta.description as () => string)()).toBe("A trip on Wanderist.");
    });

    it("singularizes the stop count and omits the distance phrase when there's exactly one stop and no distance", () => {
      const tripsStore = useTripsStore();
      tripsStore.currentTripDetail = {
        ...SAMPLE_DETAIL,
        facts: { ...SAMPLE_DETAIL.facts, stopCount: 1, distanceKm: null },
      };

      mount(TripDetailPage, buildGlobalConfig(pinia));

      const description = lastSeoMetaCall(useSeoMetaMock)
        .description as () => string;
      expect(description()).toBe("Ongoing trip with 1 stop on Wanderist.");
    });

    it("updates title once the trip loads after mount", async () => {
      const tripsStore = useTripsStore();
      tripsStore.currentTripDetail = null;

      mount(TripDetailPage, buildGlobalConfig(pinia));
      const beforeLoad = lastSeoMetaCall(useSeoMetaMock);
      expect((beforeLoad.title as () => string)()).toBe("Wanderist — Trip");

      tripsStore.currentTripDetail = { ...SAMPLE_DETAIL };
      await nextTick();

      const afterLoad = lastSeoMetaCall(useSeoMetaMock);
      expect((afterLoad.title as () => string)()).toBe(
        "Wanderist — Iceland, the ring road",
      );
    });

    it("updates og:url on in-page navigation to a different trip", async () => {
      const tripsStore = useTripsStore();
      tripsStore.currentTripDetail = { ...SAMPLE_DETAIL };

      mount(TripDetailPage, buildGlobalConfig(pinia));
      const ogUrl = lastSeoMetaCall(useSeoMetaMock).ogUrl as () => string;
      expect(ogUrl()).toBe("https://wanderist.test/trips/trip-1");

      routeParams.id = "trip-2";
      await nextTick();

      expect(ogUrl()).toBe("https://wanderist.test/trips/trip-2");
    });
  });
});
