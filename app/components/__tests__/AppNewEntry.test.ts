import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import AppNewEntry from "../AppNewEntry.vue";
import type { EntryDraft } from "~/composables/useEntryDraft";
import type { Entry } from "~/stores/entries";

const iconStub = { template: "<svg data-icon />" };

// ── Store + composable stubs ──────────────────────────────────────────────────

const mockCreateEntry = vi.fn();
const mockUpdateEntry = vi.fn();
const mockFetchEntries = vi.fn();
const mockFetchTrips = vi.fn();
const mockFetchPlaces = vi.fn();
const mockCreatePlace = vi.fn();
const mockUpload = vi.fn();
const mockSaveDraft = vi.fn();
const mockClearDraft = vi.fn();
const mockLoadDraft = vi.fn<[], EntryDraft | null>();

const tripsStoreTrips = ref<
  Array<{ id: string; name: string; status: string }>
>([]);
const placesStorePlaces = ref<Array<{ id: string; name: string }>>([]);
const placesStoreLoading = ref(false);

vi.stubGlobal("useEntriesStore", () => ({
  createEntry: mockCreateEntry,
  updateEntry: mockUpdateEntry,
  fetchEntries: mockFetchEntries,
  entries: ref([]),
  isLoading: ref(false),
  error: ref(null),
}));

vi.stubGlobal("useTripsStore", () => ({
  tripList: tripsStoreTrips.value,
  fetchTrips: mockFetchTrips,
  isLoadingList: ref(false),
}));

// Mirror Pinia's setup-store proxy: refs are unwrapped when read off the store,
// so `places`/`isLoading` read as plain values, not Refs. Getters keep them live
// across reassignment (matching the real store's `places.value = [...]`).
vi.stubGlobal("usePlacesStore", () => ({
  get places() {
    return placesStorePlaces.value;
  },
  get isLoading() {
    return placesStoreLoading.value;
  },
  fetchPlaces: mockFetchPlaces,
  createPlace: mockCreatePlace,
}));

vi.stubGlobal("useMediaUpload", () => ({
  upload: mockUpload,
  isUploading: ref(false),
}));

vi.stubGlobal("useEntryDraft", () => ({
  saveDraft: mockSaveDraft,
  loadDraft: mockLoadDraft,
  clearDraft: mockClearDraft,
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const globalConfig = {
  global: {
    stubs: {
      AppIcon: iconStub,
    },
  },
};

function mountOpen() {
  return mount(AppNewEntry, {
    props: { open: true },
    ...globalConfig,
  });
}

const SAMPLE_ENTRY: Entry = {
  id: "entry-1",
  userId: "user-1",
  tripId: null,
  placeId: null,
  title: "Harbor at 4am",
  body: "Cold morning by the water.",
  occurredAt: "2026-06-12T00:00:00.000Z",
  visibility: "public",
  weather: "clear",
  likeCount: 3,
  createdAt: "2026-06-12T04:12:00.000Z",
  updatedAt: "2026-06-12T04:12:00.000Z",
  photos: [
    { id: "photo-1", entryId: "entry-1", mediaId: "media-1", sortOrder: 0 },
  ],
  tags: [{ id: "tag-1", name: "iceland" }],
};

function mountEdit(entry: Entry = SAMPLE_ENTRY) {
  return mount(AppNewEntry, {
    props: { open: true, entry },
    ...globalConfig,
  });
}

// Mirrors the component's localIsoDate() so the date-fallback assertions stay
// timezone-stable on any host.
function localIsoDateString(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function titleInputValue(wrapper: ReturnType<typeof mountEdit>): string {
  const input = wrapper.find(
    '.field__input[placeholder="Give this moment a name…"]',
  );
  return (input.element as HTMLInputElement).value;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("AppNewEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tripsStoreTrips.value = [];
    placesStorePlaces.value = [];
    placesStoreLoading.value = false;
    mockLoadDraft.mockReturnValue(null);
    // fetchPlaces returns a Promise in the real store (the open-watch calls
    // `.catch` on it), so the default mock must resolve rather than return void.
    mockFetchPlaces.mockResolvedValue(undefined);
  });

  it("renders nothing when closed", () => {
    const wrapper = mount(AppNewEntry, {
      props: { open: false },
      ...globalConfig,
    });
    expect(wrapper.find(".drawer").exists()).toBe(false);
  });

  it("renders the drawer when open and matches snapshot", () => {
    const wrapper = mountOpen();
    expect(wrapper.find(".drawer").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the drawer header with correct title", () => {
    const wrapper = mountOpen();
    expect(wrapper.find(".drawer__head h3").text()).toBe("Capture a moment");
  });

  it("emits close when scrim is clicked", async () => {
    const wrapper = mountOpen();
    await wrapper.find(".drawer__scrim").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close when close button is clicked", async () => {
    const wrapper = mountOpen();
    await wrapper.find(".drawer__head .icon-btn").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close when cancel button is clicked", async () => {
    const wrapper = mountOpen();
    await wrapper.find(".btn--outline").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("renders the photo dropzone with add button", () => {
    const wrapper = mountOpen();
    expect(wrapper.find(".dropzone").exists()).toBe(true);
    expect(wrapper.find(".dz-add").exists()).toBe(true);
  });

  it("shows 'add photos' label on the dropzone button", () => {
    const wrapper = mountOpen();
    expect(wrapper.find(".dz-add span").text()).toBe("add photos");
  });

  it("renders 3 weather options", () => {
    const wrapper = mountOpen();
    const weatherSection = wrapper.findAll(".pill-pick").at(-1);
    expect(weatherSection?.findAll(".pick")).toHaveLength(3);
  });

  it("renders visibility toggle with Private and Public options", () => {
    const wrapper = mountOpen();
    const buttons = wrapper.find(".segmented").findAll("button");
    expect(buttons[0].text()).toBe("Private");
    expect(buttons[1].text()).toBe("Public");
    expect(buttons[0].classes()).toContain("is-active");
  });

  it("switches visibility when Public is clicked", async () => {
    const wrapper = mountOpen();
    const buttons = wrapper.find(".segmented").findAll("button");
    await buttons[1].trigger("click");
    expect(buttons[1].classes()).toContain("is-active");
    expect(buttons[0].classes()).not.toContain("is-active");
  });

  it("starts with no tags by default", () => {
    const wrapper = mountOpen();
    expect(wrapper.findAll(".tag.tag--accent")).toHaveLength(0);
  });

  it("adds a tag when enter is pressed in the tag input", async () => {
    const wrapper = mountOpen();
    const tagInput = wrapper.find(".tags-input input");
    await tagInput.setValue("adventure");
    await tagInput.trigger("keydown.enter");
    expect(wrapper.find(".tags-input").text()).toContain("adventure");
  });

  it("removes a tag when its remove button is clicked", async () => {
    const wrapper = mountOpen();
    const tagInput = wrapper.find(".tags-input input");
    await tagInput.setValue("iceland");
    await tagInput.trigger("keydown.enter");
    const removeButtons = wrapper.findAll(".tag-x");
    await removeButtons[0].trigger("click");
    expect(wrapper.find(".tags-input").text()).not.toContain("iceland");
  });

  it("renders a None trip option when trips store is empty", () => {
    const wrapper = mountOpen();
    const tripPicks = wrapper.find(".pill-pick");
    expect(tripPicks.text()).toContain("None");
  });

  it("renders trip options from the trips store", () => {
    tripsStoreTrips.value = [
      { id: "trip-1", name: "Iceland Ring Road", status: "ongoing" },
      { id: "trip-2", name: "Portugal 2026", status: "past" },
    ];
    const wrapper = mountOpen();
    const picks = wrapper.find(".pill-pick").findAll(".pick");
    const labels = picks.map((pick) => pick.text());
    expect(labels).toContain("Iceland Ring Road");
    expect(labels).toContain("Portugal 2026");
    expect(labels).toContain("None");
  });

  it("defaults to the ongoing trip when trips are available", () => {
    tripsStoreTrips.value = [
      { id: "trip-1", name: "Iceland Ring Road", status: "ongoing" },
      { id: "trip-2", name: "Portugal 2026", status: "past" },
    ];
    const wrapper = mountOpen();
    const activePick = wrapper.find(".pill-pick .pick.is-active");
    expect(activePick.text()).toBe("Iceland Ring Road");
  });

  it("does not clobber an explicit 'None' selection when trips load", async () => {
    tripsStoreTrips.value = [];
    const wrapper = mountOpen();

    // User explicitly selects None before trips arrive
    const nonePick = wrapper.find(".pill-pick .pick.is-active");
    await nonePick.trigger("click");

    // Simulate trips loading after the selection
    tripsStoreTrips.value = [
      { id: "trip-1", name: "Iceland Ring Road", status: "ongoing" },
    ];
    await wrapper.vm.$nextTick();

    // None should still be selected
    const activePick = wrapper.find(".pill-pick .pick.is-active");
    expect(activePick.text()).toBe("None");
  });

  it("renders location suggestion chips from the places store", () => {
    placesStorePlaces.value = [
      { id: "p-1", name: "Old Harbour" },
      { id: "p-2", name: "Hallgrímskirkja" },
    ];
    const wrapper = mountOpen();
    expect(wrapper.find(".chip-suggest").exists()).toBe(true);
    expect(wrapper.findAll(".chip")).toHaveLength(2);
  });

  it("hides location chip suggestions when places store is empty", () => {
    const wrapper = mountOpen();
    expect(wrapper.find(".chip-suggest").exists()).toBe(false);
  });

  it("updates location when a suggestion chip is clicked", async () => {
    placesStorePlaces.value = [
      { id: "p-1", name: "Old Harbour" },
      { id: "p-2", name: "Hallgrímskirkja" },
    ];
    const wrapper = mountOpen();
    const chips = wrapper.findAll(".chip");
    await chips[0].trigger("click");
    const locationField = wrapper
      .find(".chip-suggest")
      .element.closest(".field");
    const locationInput = locationField?.querySelector(
      ".field__input",
    ) as HTMLInputElement | null;
    expect(locationInput?.value).toBe("Old Harbour");
  });

  it("renders publish and save draft buttons in footer", () => {
    const wrapper = mountOpen();
    expect(wrapper.find(".drawer__foot .btn--primary").text()).toContain(
      "publish",
    );
    expect(wrapper.find(".drawer__foot .btn--ghost").text()).toContain(
      "save draft",
    );
  });

  it("calls createEntry and emits close on publish", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountOpen();
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockCreateEntry).toHaveBeenCalledOnce();
    expect(mockFetchEntries).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("clears the draft from storage on successful publish", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountOpen();
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockClearDraft).toHaveBeenCalledOnce();
  });

  it("shows publish error when createEntry throws", async () => {
    mockCreateEntry.mockRejectedValue(new Error("Server error"));

    const wrapper = mountOpen();
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="publish-error"]').text()).toContain(
      "Server error",
    );
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("calls saveDraft composable when save draft is clicked", async () => {
    const wrapper = mountOpen();
    await wrapper.find(".btn--ghost").trigger("click");
    expect(mockSaveDraft).toHaveBeenCalledOnce();
    expect(mockSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ uploadedPhotos: expect.any(Array) }),
    );
  });

  it("saves the resolved placeId into the draft", async () => {
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
    const wrapper = mountOpen();
    await wrapper.findAll(".chip")[0].trigger("click");
    await wrapper.find(".btn--ghost").trigger("click");
    expect(mockSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ location: "Old Harbour", placeId: "p-1" }),
    );
  });

  it("restores saved draft when drawer opens", async () => {
    const draft: EntryDraft = {
      title: "Restored title",
      body: "Some body text",
      location: "Lisbon",
      tripId: "trip-saved",
      date: "2026-06-01",
      visibility: "public",
      tags: ["portugal"],
      weather: "clear",
      uploadedPhotos: [],
    };
    mockLoadDraft.mockReturnValue(draft);

    const wrapper = mountOpen();
    await wrapper.vm.$nextTick();

    const titleInput = wrapper.find(
      '.field__input[placeholder="Give this moment a name…"]',
    );
    expect((titleInput.element as HTMLInputElement).value).toBe(
      "Restored title",
    );
  });

  it("emits close before fetchEntries so a refresh failure cannot create duplicate entries", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockRejectedValue(new Error("network error"));

    const wrapper = mountOpen();
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // close should fire even though fetchEntries rejected
    expect(wrapper.emitted("close")).toBeTruthy();
    // and the error should NOT be shown (it is a non-fatal refresh failure)
    expect(wrapper.find('[data-test="publish-error"]').exists()).toBe(false);
  });

  function stubSuccessfulPublish() {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });
  }

  async function publishAndReadPayload(
    wrapper: ReturnType<typeof mountOpen>,
  ): Promise<Record<string, unknown>> {
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    return mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
  }

  it("sends the selected place's id as placeId when a suggestion is clicked", async () => {
    stubSuccessfulPublish();
    placesStorePlaces.value = [
      { id: "p-1", name: "Old Harbour" },
      { id: "p-2", name: "Hallgrímskirkja" },
    ];

    const wrapper = mountOpen();
    const chips = wrapper.findAll(".chip");
    await chips[0].trigger("click");

    const callArg = await publishAndReadPayload(wrapper);
    expect(callArg.placeId).toBe("p-1");
  });

  it("resolves placeId case-insensitively and ignores surrounding whitespace when typed", async () => {
    stubSuccessfulPublish();
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("  old harbour  ");

    const callArg = await publishAndReadPayload(wrapper);
    expect(callArg.placeId).toBe("p-1");
  });

  it("does not reuse a previously selected placeId after the location is edited to non-matching text", async () => {
    stubSuccessfulPublish();
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
    mockCreatePlace.mockImplementation(async ({ name }: { name: string }) => ({
      id: "place-new",
      name,
    }));

    const wrapper = mountOpen();
    await wrapper.findAll(".chip")[0].trigger("click");
    // User then hand-edits the field to something that is not a saved place.
    await wrapper.get('[data-test="location-input"]').setValue("Elsewhere");

    const callArg = await publishAndReadPayload(wrapper);
    // The stale chip id must not ride along; the edited free text is created anew.
    expect(callArg.placeId).toBe("place-new");
    expect(mockCreatePlace).toHaveBeenCalledWith({ name: "Elsewhere" });
  });

  it("carries a restored draft's saved placeId into the publish payload", async () => {
    stubSuccessfulPublish();
    mockLoadDraft.mockReturnValue({
      title: "Restored",
      body: "",
      location: "Old Harbour",
      placeId: "p-9",
      tripId: "",
      date: "2026-06-01",
      visibility: "private",
      tags: [],
      weather: "",
      uploadedPhotos: [],
    });

    const wrapper = mountOpen();
    await wrapper.vm.$nextTick();

    const callArg = await publishAndReadPayload(wrapper);
    expect(callArg.placeId).toBe("p-9");
  });

  it("does not trust a restored placeId whose place no longer exists and re-creates the typed location", async () => {
    stubSuccessfulPublish();
    // The saved place (p-9) is gone; the loaded list has an unrelated place.
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
    mockCreatePlace.mockImplementation(async ({ name }: { name: string }) => ({
      id: "place-new",
      name,
    }));
    mockLoadDraft.mockReturnValue({
      title: "Restored",
      body: "",
      location: "Deleted Spot",
      placeId: "p-9",
      tripId: "",
      date: "2026-06-01",
      visibility: "private",
      tags: [],
      weather: "",
      uploadedPhotos: [],
    });

    const wrapper = mountOpen();
    await wrapper.vm.$nextTick();

    const callArg = await publishAndReadPayload(wrapper);
    // The dead id is not trusted (the server would reject it); the typed
    // location is created fresh instead of riding the stale placeId.
    expect(callArg.placeId).toBe("place-new");
    expect(mockCreatePlace).toHaveBeenCalledWith({ name: "Deleted Spot" });
  });

  it("passes occurredAt derived from the local date string the user chose", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountOpen();

    const dateInput = wrapper.find('input[type="date"]');
    await dateInput.setValue("2026-06-14");

    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    const occurredAt = callArg.occurredAt as string;

    // The ISO string should represent local midnight for June 14. Parsing it
    // back and reading local date components is timezone-stable on any host.
    const parsed = new Date(occurredAt);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(5); // 0-indexed: 5 = June
    expect(parsed.getDate()).toBe(14); // local calendar date, not UTC
  });

  it("hides the inline create-place affordance when the location is empty", () => {
    const wrapper = mountOpen();
    expect(wrapper.find(".location-create").exists()).toBe(false);
  });

  it("offers inline place creation when the typed location matches no saved place", async () => {
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
    const wrapper = mountOpen();

    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    const affordance = wrapper.find(".location-create");
    expect(affordance.exists()).toBe(true);
    expect(affordance.text()).toContain("Blue Lagoon");
  });

  it("suppresses the create-place affordance while places are still loading", async () => {
    placesStoreLoading.value = true;
    const wrapper = mountOpen();

    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    expect(wrapper.find(".location-create").exists()).toBe(false);
  });

  it("suppresses the create-place affordance when the places list failed to load", async () => {
    mockFetchPlaces.mockRejectedValue(new Error("offline"));
    const wrapper = mountOpen();
    await flushPromises();

    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    expect(wrapper.find(".location-create").exists()).toBe(false);
  });

  it("does not offer creation when the typed location matches a saved place (case-insensitive)", async () => {
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
    const wrapper = mountOpen();

    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("  old harbour  ");

    expect(wrapper.find(".location-create").exists()).toBe(false);
  });

  it("matches an existing place across internal whitespace and Unicode form", async () => {
    // Saved with a precomposed e-acute (U+00E9) and a single space.
    const savedName = "Caf\u00e9 Central";
    placesStorePlaces.value = [{ id: "p-1", name: savedName }];
    const wrapper = mountOpen();

    const locationInput = wrapper.get('[data-test="location-input"]');
    // Typed with a decomposed e + combining acute (U+0301) and a double space;
    // only NFC + whitespace collapse folds this onto the saved name.
    await locationInput.setValue("cafe\u0301  central");

    expect(wrapper.find(".location-create").exists()).toBe(false);
  });

  it("creates a place from the typed location and attaches its id on publish", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });
    mockCreatePlace.mockImplementation(async ({ name }: { name: string }) => {
      const created = { id: "place-new", name };
      // Reassign, matching the real store's `places.value = [...places.value, x]`.
      placesStorePlaces.value = [...placesStorePlaces.value, created];
      return created;
    });

    const wrapper = mountOpen();

    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    await wrapper.find(".location-create__btn").trigger("click");
    await wrapper.vm.$nextTick();

    expect(mockCreatePlace).toHaveBeenCalledWith({ name: "Blue Lagoon" });
    // Affordance disappears once the new place matches the field.
    expect(wrapper.find(".location-create").exists()).toBe(false);

    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.placeId).toBe("place-new");
    // Publish must reuse the place created via the button, not mint a second.
    expect(mockCreatePlace).toHaveBeenCalledTimes(1);
  });

  it("sends no placeId and creates no place when the location is left empty", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountOpen();
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockCreatePlace).not.toHaveBeenCalled();
    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.placeId).toBeUndefined();
  });

  it("attaches the id of an existing saved place when the location matches it", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Old Harbour");

    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.placeId).toBe("p-1");
    expect(mockCreatePlace).not.toHaveBeenCalled();
  });

  it("reuses the first saved place (not a new duplicate) when two share the typed name", async () => {
    stubSuccessfulPublish();
    placesStorePlaces.value = [
      { id: "p-1", name: "Old Town" },
      { id: "p-2", name: "Old Town" },
    ];

    const wrapper = mountOpen();
    await wrapper.get('[data-test="location-input"]').setValue("Old Town");

    const callArg = await publishAndReadPayload(wrapper);
    // Ambiguous by name: deliberately reuse the first saved match rather than
    // minting a duplicate place.
    expect(callArg.placeId).toBe("p-1");
    expect(mockCreatePlace).not.toHaveBeenCalled();
  });

  it("creates only one entry when publish is double-clicked", async () => {
    placesStorePlaces.value = [];
    let resolveEntry: (entry: { id: string }) => void = () => {};
    mockCreateEntry.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEntry = () => resolve({ id: "new-entry-1" });
        }),
    );
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountOpen();
    const publishButton = wrapper.find(".btn--primary");
    // Fire both clicks before awaiting either, so :disabled hasn't flushed and
    // only the synchronous isPublishing guard can stop the second entry.
    const firstClick = publishButton.trigger("click");
    const secondClick = publishButton.trigger("click");
    await Promise.all([firstClick, secondClick]);

    resolveEntry({ id: "new-entry-1" });
    await flushPromises();

    expect(mockCreateEntry).toHaveBeenCalledTimes(1);
  });

  it("creates only one place when the create button is double-clicked", async () => {
    placesStorePlaces.value = [];
    let resolveCreate: (place: { id: string; name: string }) => void = () => {};
    mockCreatePlace.mockImplementation(
      ({ name }: { name: string }) =>
        new Promise((resolve) => {
          resolveCreate = () => resolve({ id: "place-new", name });
        }),
    );

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    const button = wrapper.find(".location-create__btn");
    // Fire both clicks before awaiting either, so the disabled attribute hasn't
    // flushed and only the synchronous isCreatingPlace guard can stop the second.
    const firstClick = button.trigger("click");
    const secondClick = button.trigger("click");
    await Promise.all([firstClick, secondClick]);

    resolveCreate({ id: "place-new", name: "Blue Lagoon" });
    await wrapper.vm.$nextTick();

    expect(mockCreatePlace).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite the location if the user retypes while the create is in flight", async () => {
    placesStorePlaces.value = [];
    let resolveCreate: (place: { id: string; name: string }) => void = () => {};
    mockCreatePlace.mockImplementation(
      ({ name }: { name: string }) =>
        new Promise((resolve) => {
          resolveCreate = () => resolve({ id: "place-new", name });
        }),
    );

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");
    await wrapper.find(".location-create__btn").trigger("click");

    // User keeps typing before the POST resolves.
    await locationInput.setValue("Red Bay");
    resolveCreate({ id: "place-new", name: "Blue Lagoon" });
    // flushPromises (not a single nextTick) so the resolution fully propagates
    // through runCreatePlace before we assert the guard suppressed the write.
    await flushPromises();

    expect((locationInput.element as HTMLInputElement).value).toBe("Red Bay");
    expect(wrapper.find(".error-hint").exists()).toBe(false);
  });

  it("auto-creates the place on publish when the user did not use the create button", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });
    placesStorePlaces.value = [];
    mockCreatePlace.mockImplementation(async ({ name }: { name: string }) => {
      const created = { id: "place-auto", name };
      placesStorePlaces.value = [...placesStorePlaces.value, created];
      return created;
    });

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    // Sloppy whitespace: the persisted body must be canonicalized.
    await locationInput.setValue("  Blue   Lagoon  ");

    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockCreatePlace).toHaveBeenCalledWith({ name: "Blue Lagoon" });
    expect(mockCreatePlace).toHaveBeenCalledTimes(1);
    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.placeId).toBe("place-auto");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("aborts publish and keeps the drawer open when auto-creating the place fails", async () => {
    placesStorePlaces.value = [];
    mockCreatePlace.mockRejectedValue(new Error("Place limit reached"));

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockCreateEntry).not.toHaveBeenCalled();
    expect(wrapper.emitted("close")).toBeFalsy();
    expect(wrapper.find(".error-hint").text()).toContain("Place limit reached");
  });

  it("shows an error and keeps the affordance when place creation fails", async () => {
    placesStorePlaces.value = [];
    mockCreatePlace.mockRejectedValue(new Error("Place limit reached"));

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    await wrapper.find(".location-create__btn").trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".location-create__error").text()).toContain(
      "Place limit reached",
    );
    expect(wrapper.find(".location-create").exists()).toBe(true);
  });

  it("does not stamp a stale create error onto a fresh form after the drawer reopens", async () => {
    placesStorePlaces.value = [];
    // Reopen restores the SAME location via a draft, so the field-name check
    // alone would not suppress the stale error — only the token guard does.
    const draft: EntryDraft = {
      title: "",
      body: "",
      location: "Blue Lagoon",
      tripId: "",
      date: "2026-06-01",
      visibility: "private",
      tags: [],
      weather: "",
      uploadedPhotos: [],
    };
    mockLoadDraft.mockReturnValue(draft);

    let rejectCreate: (reason: Error) => void = () => {};
    mockCreatePlace.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCreate = reject;
        }),
    );

    const wrapper = mountOpen();
    await wrapper.find(".location-create__btn").trigger("click");

    // Reopen while the create is in flight; the draft restores "Blue Lagoon".
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });

    rejectCreate(new Error("Place limit reached"));
    // flushPromises (not a single nextTick) so the rejection reaches the catch
    // before we assert the token guard suppressed the stale error.
    await flushPromises();

    // The fresh form holds the restored "Blue Lagoon" but shows no stale error
    // (the failed create belonged to the pre-reopen request).
    const freshLocationInput = wrapper.get('[data-test="location-input"]');
    expect((freshLocationInput.element as HTMLInputElement).value).toBe(
      "Blue Lagoon",
    );
    expect(wrapper.find(".location-create__error").exists()).toBe(false);
  });

  it("still persists a typed location on publish even when the places list failed to load", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });
    // Failed-to-load (untrustworthy) list: the affordance is hidden, but publish
    // must not silently drop the typed location.
    mockFetchPlaces.mockRejectedValue(new Error("offline"));
    placesStorePlaces.value = [];
    mockCreatePlace.mockImplementation(async ({ name }: { name: string }) => {
      const created = { id: "place-auto", name };
      placesStorePlaces.value = [...placesStorePlaces.value, created];
      return created;
    });

    const wrapper = mountOpen();
    await flushPromises();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");
    // Affordance stays hidden because the list is untrustworthy.
    expect(wrapper.find(".location-create").exists()).toBe(false);

    await wrapper.find(".btn--primary").trigger("click");
    await flushPromises();

    expect(mockCreatePlace).toHaveBeenCalledWith({ name: "Blue Lagoon" });
    expect(mockCreatePlace).toHaveBeenCalledTimes(1);
    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.placeId).toBe("place-auto");
  });

  it("re-fetches a failed list on publish and reuses an existing place instead of creating a duplicate", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });
    placesStorePlaces.value = [];
    // First load (on open) fails; the retry during publish succeeds and surfaces
    // a place that matches the typed location.
    mockFetchPlaces
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(async () => {
        placesStorePlaces.value = [{ id: "p-1", name: "Blue Lagoon" }];
      });

    const wrapper = mountOpen();
    await flushPromises();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    await wrapper.find(".btn--primary").trigger("click");
    await flushPromises();

    expect(mockCreatePlace).not.toHaveBeenCalled();
    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.placeId).toBe("p-1");
  });

  it("settles an in-flight list on publish and creates from the location snapshot, not a mid-flight edit", async () => {
    mockCreateEntry.mockResolvedValue({ id: "new-entry-1" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });
    placesStorePlaces.value = [];
    // List is mid-load at publish time, so resolvePlaceId settles it first.
    placesStoreLoading.value = true;
    let resolveFetch: () => void = () => {};
    mockFetchPlaces.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    mockCreatePlace.mockImplementation(async ({ name }: { name: string }) => ({
      id: "place-auto",
      name,
    }));

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Blue Lagoon");

    await wrapper.find(".btn--primary").trigger("click");
    // The settle fetch is in flight; the user clears the field before it resolves.
    await locationInput.setValue("");
    resolveFetch();
    await flushPromises();

    // The list was re-fetched (settle path) and the place was created from the
    // snapshot taken at publish time, not the now-empty field.
    expect(mockFetchPlaces).toHaveBeenCalled();
    expect(mockCreatePlace).toHaveBeenCalledWith({ name: "Blue Lagoon" });
    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.placeId).toBe("place-auto");
  });

  it("shows a fail-loud hint when the places list could not be loaded", async () => {
    mockFetchPlaces.mockRejectedValue(new Error("offline"));
    const wrapper = mountOpen();
    await flushPromises();

    expect(wrapper.find(".places-load__error").exists()).toBe(true);
  });

  it("clears uploadError before starting a new upload batch", async () => {
    // First upload fails
    mockUpload.mockRejectedValueOnce(new Error("Network error"));
    // Second upload succeeds
    mockUpload.mockResolvedValueOnce({
      id: "media-2",
      url: "https://example.com/photo2.jpg",
    });

    const wrapper = mountOpen();
    const fileInput = wrapper.find('input[type="file"]');

    const failFile = new File(["fail"], "fail.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput.element, "files", {
      value: [failFile],
      configurable: true,
    });
    await fileInput.trigger("change");
    await wrapper.vm.$nextTick();

    // Error should be visible
    expect(wrapper.find('[data-test="upload-error"]').exists()).toBe(true);

    // Second upload succeeds — error should clear
    const successFile = new File(["ok"], "ok.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput.element, "files", {
      value: [successFile],
      configurable: true,
    });
    await fileInput.trigger("change");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="upload-error"]').exists()).toBe(false);
  });
});

describe("AppNewEntry — edit mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tripsStoreTrips.value = [];
    placesStorePlaces.value = [];
    mockLoadDraft.mockReturnValue(null);
  });

  it("renders the edit header instead of the create header", () => {
    const wrapper = mountEdit();
    expect(wrapper.find(".drawer__head h3").text()).toBe("Edit this moment");
    expect(wrapper.find(".drawer__head .label").text()).toContain("edit entry");
  });

  it("pre-fills the form fields from the entry", () => {
    const wrapper = mountEdit();
    expect(titleInputValue(wrapper)).toBe("Harbor at 4am");
    expect(wrapper.find(".tags-input").text()).toContain("iceland");
    const publicButton = wrapper.find(".segmented").findAll("button")[1];
    expect(publicButton.classes()).toContain("is-active");
  });

  it("hides the save-draft button in edit mode", () => {
    const wrapper = mountEdit();
    expect(wrapper.find(".drawer__foot .btn--ghost").exists()).toBe(false);
  });

  it("labels the primary action 'save changes' in edit mode", () => {
    const wrapper = mountEdit();
    expect(wrapper.find(".drawer__foot .btn--primary").text()).toContain(
      "save changes",
    );
  });

  it("ignores any saved create-draft when editing", () => {
    mockLoadDraft.mockReturnValue({
      title: "A different draft",
      body: "",
      location: "",
      tripId: "",
      date: "2026-01-01",
      visibility: "private",
      tags: [],
      weather: "",
      uploadedPhotos: [],
    });
    const wrapper = mountEdit();
    expect(titleInputValue(wrapper)).toBe("Harbor at 4am");
  });

  it("calls updateEntry with the entry id and edited fields and emits close", async () => {
    mockUpdateEntry.mockResolvedValue({ ...SAMPLE_ENTRY, title: "New title" });
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountEdit();
    const titleInput = wrapper.find(
      '.field__input[placeholder="Give this moment a name…"]',
    );
    await titleInput.setValue("New title");

    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockUpdateEntry).toHaveBeenCalledOnce();
    expect(mockCreateEntry).not.toHaveBeenCalled();
    const [id, payload] = mockUpdateEntry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe("entry-1");
    expect(payload.title).toBe("New title");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("resolves a typed location to an existing saved place id on the update payload", async () => {
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
    mockUpdateEntry.mockResolvedValue(SAMPLE_ENTRY);
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountEdit();
    await wrapper.get('[data-test="location-input"]').setValue("Old Harbour");

    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const [, payload] = mockUpdateEntry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    // Editing resolves the place synchronously and never inline-creates one.
    expect(payload.placeId).toBe("p-1");
    expect(mockCreatePlace).not.toHaveBeenCalled();
  });

  it("preserves the entry's existing photos in the update payload", async () => {
    mockUpdateEntry.mockResolvedValue(SAMPLE_ENTRY);
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountEdit();
    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const [, payload] = mockUpdateEntry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.photoMediaIds).toEqual(["media-1"]);
  });

  it("does not clear the create-draft when saving an edit", async () => {
    mockUpdateEntry.mockResolvedValue(SAMPLE_ENTRY);
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountEdit();
    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockClearDraft).not.toHaveBeenCalled();
  });

  it("shows an error and keeps the drawer open when updateEntry throws", async () => {
    mockUpdateEntry.mockRejectedValue(new Error("Update failed"));

    const wrapper = mountEdit();
    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".error-hint").text()).toContain("Update failed");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("persists cleared body and tags instead of silently reverting them", async () => {
    mockUpdateEntry.mockResolvedValue(SAMPLE_ENTRY);
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountEdit();
    await wrapper.find("textarea").setValue("");
    await wrapper.find(".tag-x").trigger("click");
    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const [, payload] = mockUpdateEntry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.body).toBe("");
    expect(payload.tags).toEqual([]);
  });

  it("appends a newly uploaded photo to the entry's existing photos", async () => {
    mockUpload.mockResolvedValueOnce({
      id: "new-media",
      url: "https://example.com/new.jpg",
    });
    mockUpdateEntry.mockResolvedValue(SAMPLE_ENTRY);
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });

    const wrapper = mountEdit();
    const fileInput = wrapper.find('input[type="file"]');
    const file = new File(["x"], "new.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput.element, "files", {
      value: [file],
      configurable: true,
    });
    await fileInput.trigger("change");
    await wrapper.vm.$nextTick();

    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const [, payload] = mockUpdateEntry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.photoMediaIds).toEqual(["media-1", "new-media"]);
  });

  it("pre-fills the date input from the entry's occurredAt", () => {
    const wrapper = mountEdit();
    const occurred = new Date(SAMPLE_ENTRY.occurredAt as string);
    const expected = `${occurred.getFullYear()}-${String(
      occurred.getMonth() + 1,
    ).padStart(2, "0")}-${String(occurred.getDate()).padStart(2, "0")}`;
    const dateInput = wrapper.find('input[type="date"]')
      .element as HTMLInputElement;
    expect(dateInput.value).toBe(expected);
  });

  it("re-seeds the form when a different entry is edited while the drawer stays open", async () => {
    const wrapper = mountEdit();
    expect(titleInputValue(wrapper)).toBe("Harbor at 4am");

    await wrapper.setProps({
      entry: { ...SAMPLE_ENTRY, id: "entry-2", title: "Tram 28, again" },
    });

    expect(titleInputValue(wrapper)).toBe("Tram 28, again");
  });

  it("falls back to today's date when the entry has no occurredAt", () => {
    const wrapper = mountEdit({ ...SAMPLE_ENTRY, occurredAt: null });
    const dateInput = wrapper.find('input[type="date"]')
      .element as HTMLInputElement;
    expect(dateInput.value).toBe(localIsoDateString());
  });

  it("falls back to today's date when occurredAt is unparseable", () => {
    const wrapper = mountEdit({ ...SAMPLE_ENTRY, occurredAt: "not-a-date" });
    const dateInput = wrapper.find('input[type="date"]')
      .element as HTMLInputElement;
    expect(dateInput.value).toBe(localIsoDateString());
  });

  it("resets to create mode when the entry prop clears while the drawer stays open", async () => {
    const wrapper = mountEdit();
    expect(wrapper.find(".drawer__head h3").text()).toBe("Edit this moment");

    await wrapper.setProps({ entry: null });

    expect(wrapper.find(".drawer__head h3").text()).toBe("Capture a moment");
    expect(wrapper.find(".drawer__foot .btn--primary").text()).toContain(
      "publish",
    );
    expect(wrapper.find(".drawer__foot .btn--ghost").exists()).toBe(true);
    expect(titleInputValue(wrapper)).toBe("");
  });

  it("disables the None trip option when editing an entry that has a trip", () => {
    tripsStoreTrips.value = [
      { id: "trip-1", name: "Iceland Ring Road", status: "ongoing" },
    ];
    const picks = mountEdit({ ...SAMPLE_ENTRY, tripId: "trip-1" })
      .find(".pill-pick")
      .findAll(".pick");
    const nonePick = picks.find((pick) => pick.text() === "None");
    expect(nonePick).toBeTruthy();
    expect(nonePick?.attributes("disabled")).toBeDefined();
    const tripPick = picks.find((pick) => pick.text() === "Iceland Ring Road");
    expect(tripPick?.attributes("disabled")).toBeUndefined();
  });

  it("leaves the None trip option enabled when editing a trip-less entry", () => {
    tripsStoreTrips.value = [
      { id: "trip-1", name: "Iceland Ring Road", status: "ongoing" },
    ];
    const nonePick = mountEdit({ ...SAMPLE_ENTRY, tripId: null })
      .find(".pill-pick")
      .findAll(".pick")
      .find((pick) => pick.text() === "None");
    expect(nonePick?.attributes("disabled")).toBeUndefined();
  });

  it("leaves the None trip option enabled in create mode", () => {
    tripsStoreTrips.value = [
      { id: "trip-1", name: "Iceland Ring Road", status: "ongoing" },
    ];
    const nonePick = mountOpen()
      .find(".pill-pick")
      .findAll(".pick")
      .find((pick) => pick.text() === "None");
    expect(nonePick?.attributes("disabled")).toBeUndefined();
  });

  it("PATCHes the edited entry's own content when the entry prop clears mid-save", async () => {
    // A slow places fetch keeps publish awaiting inside its try block, giving
    // the parent a window to null the entry (e.g. ⌘K opens a new entry) before
    // the payload is built. A create-draft is waiting in localStorage, so a
    // re-seed here would overwrite the edited entry with the draft's content
    // under the snapshotted id. Both the mode and the form must stay put.
    mockUpdateEntry.mockResolvedValue(SAMPLE_ENTRY);
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
    });
    mockLoadDraft.mockReturnValue({
      title: "Unrelated draft",
      body: "draft body",
      location: "",
      tripId: "",
      date: "2026-01-01",
      visibility: "private",
      tags: ["draft-tag"],
      weather: "",
      uploadedPhotos: [{ id: "draft-media", url: "" }],
    });
    let settleFirstFetch: () => void = () => {};
    let fetchCalls = 0;
    mockFetchPlaces.mockImplementation(() => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Promise<void>((resolve) => {
          settleFirstFetch = resolve;
        });
      }
      return Promise.resolve();
    });

    const wrapper = mountEdit();
    await wrapper.get('[data-test="location-input"]').setValue("Somewhere");

    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.setProps({ entry: null });

    settleFirstFetch();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockUpdateEntry).toHaveBeenCalledOnce();
    expect(mockCreateEntry).not.toHaveBeenCalled();
    const [id, payload] = mockUpdateEntry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    // The edited entry's own content must reach the PATCH, never the draft's.
    expect(id).toBe("entry-1");
    expect(payload.title).toBe("Harbor at 4am");
    expect(payload.photoMediaIds).toEqual(["media-1"]);
  });

  it("re-seeds to create mode when a save fails after the entry prop cleared mid-save", async () => {
    // Same race, but the save rejects. The deferred re-seed must replay so the
    // drawer catches up to create mode instead of stranding entry A's content
    // bound to a create-shaped publish (which would duplicate it on retry).
    mockUpdateEntry.mockRejectedValue(new Error("Update failed"));
    let settleFirstFetch: () => void = () => {};
    let fetchCalls = 0;
    mockFetchPlaces.mockImplementation(() => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Promise<void>((resolve) => {
          settleFirstFetch = resolve;
        });
      }
      return Promise.resolve();
    });

    const wrapper = mountEdit();
    await wrapper.get('[data-test="location-input"]').setValue("Somewhere");

    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.setProps({ entry: null });

    settleFirstFetch();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".drawer__head h3").text()).toBe("Capture a moment");
    expect(titleInputValue(wrapper)).toBe("");
    // The save failed, so the failure must survive the re-seed rather than being
    // silently cleared when the form catches up to create mode.
    expect(wrapper.find('[data-test="publish-error"]').text()).toContain(
      "Update failed",
    );
  });
});
