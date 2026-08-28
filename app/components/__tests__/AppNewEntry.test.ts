import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
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
const mockUpload = vi.fn();
const mockSaveDraft = vi.fn();
const mockClearDraft = vi.fn();
const mockLoadDraft = vi.fn<[], EntryDraft | null>();

const tripsStoreTrips = ref<
  Array<{ id: string; name: string; status: string }>
>([]);
const placesStorePlaces = ref<Array<{ id: string; name: string }>>([]);
const placesStoreIsLoading = ref(false);
const placesStoreError = ref<string | null>(null);

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

// Getters mirror how Pinia hands back reactive state unwrapped: the drawer
// reads `placesStore.places`/`isLoading`/`error` as plain values, and tests
// can flip the backing refs (e.g. places arriving after the drawer opens).
vi.stubGlobal("usePlacesStore", () => ({
  get places() {
    return placesStorePlaces.value;
  },
  fetchPlaces: mockFetchPlaces,
  get isLoading() {
    return placesStoreIsLoading.value;
  },
  get error() {
    return placesStoreError.value;
  },
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
    placesStoreIsLoading.value = false;
    placesStoreError.value = null;
    mockLoadDraft.mockReturnValue(null);
    // Real fetchPlaces returns a Promise; the drawer chains .catch on it.
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

  it("omits placeId and warns when the typed location matches no known place", async () => {
    stubSuccessfulPublish();
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];

    const wrapper = mountOpen();
    const locationInput = wrapper.get('[data-test="location-input"]');
    await locationInput.setValue("Somewhere unlisted");

    // The user is told the free text will not be attached, rather than it
    // being silently dropped.
    expect(wrapper.find('[data-test="location-warning"]').exists()).toBe(true);

    const callArg = await publishAndReadPayload(wrapper);
    expect(callArg.placeId).toBeUndefined();
  });

  it("clears a previously selected placeId when the location is edited to non-matching text", async () => {
    stubSuccessfulPublish();
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];

    const wrapper = mountOpen();
    await wrapper.findAll(".chip")[0].trigger("click");
    // User then hand-edits the field to something that is not a saved place.
    await wrapper.get('[data-test="location-input"]').setValue("Elsewhere");

    const callArg = await publishAndReadPayload(wrapper);
    expect(callArg.placeId).toBeUndefined();
  });

  it("refuses to guess a placeId when two saved places share the typed name", async () => {
    stubSuccessfulPublish();
    placesStorePlaces.value = [
      { id: "p-1", name: "Old Town" },
      { id: "p-2", name: "Old Town" },
    ];

    const wrapper = mountOpen();
    await wrapper.get('[data-test="location-input"]').setValue("Old Town");

    // Ambiguous by name: no arbitrary place is attached, and the user is warned.
    expect(wrapper.find('[data-test="location-warning"]').exists()).toBe(true);

    const callArg = await publishAndReadPayload(wrapper);
    expect(callArg.placeId).toBeUndefined();
  });

  it("resolves a typed location once the places list arrives after opening", async () => {
    stubSuccessfulPublish();
    // Cold store: no places yet when the drawer opens and the user types.
    const wrapper = mountOpen();
    await wrapper.get('[data-test="location-input"]').setValue("Old Harbour");
    expect(wrapper.find('[data-test="location-warning"]').exists()).toBe(true);

    // Places load afterwards — the resolution must recompute reactively.
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="location-warning"]').exists()).toBe(false);

    const callArg = await publishAndReadPayload(wrapper);
    expect(callArg.placeId).toBe("p-1");
  });

  it("does not warn about an unresolved location while places are still loading", async () => {
    placesStoreIsLoading.value = true;
    const wrapper = mountOpen();
    await wrapper.get('[data-test="location-input"]').setValue("Old Harbour");
    expect(wrapper.find('[data-test="location-warning"]').exists()).toBe(false);
  });

  it("shows a load-failure hint (not the no-such-place warning) when the places fetch failed", async () => {
    placesStoreError.value = "network down";
    const wrapper = mountOpen();
    await wrapper.get('[data-test="location-input"]').setValue("Old Harbour");
    // The failure is surfaced as a load problem, not blamed on the user's input.
    expect(wrapper.find('[data-test="location-warning"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="places-load-error"]').exists()).toBe(true);
  });

  it("waits for the places prefetch before publishing a typed location", async () => {
    stubSuccessfulPublish();
    // fetchPlaces stays pending until we resolve it, mimicking a slow load; the
    // place only becomes known when it settles.
    let settleFetch: () => void = () => {};
    mockFetchPlaces.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settleFetch = () => {
            placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
            resolve();
          };
        }),
    );

    const wrapper = mountOpen();
    await wrapper.get('[data-test="location-input"]').setValue("Old Harbour");

    // Publish before the fetch settles — it must not create the entry yet.
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    expect(mockCreateEntry).not.toHaveBeenCalled();

    settleFetch();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockCreateEntry).toHaveBeenCalledOnce();
    const callArg = mockCreateEntry.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.placeId).toBe("p-1");
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

  it("drops a restored placeId whose place no longer exists and warns", async () => {
    stubSuccessfulPublish();
    // The saved place (p-9) is gone; the loaded list has an unrelated place.
    placesStorePlaces.value = [{ id: "p-1", name: "Old Harbour" }];
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

    // The dead id must not be trusted (the server would reject it); the user
    // is warned rather than trapped behind a failing publish.
    expect(wrapper.find('[data-test="location-warning"]').exists()).toBe(true);

    const callArg = await publishAndReadPayload(wrapper);
    expect(callArg.placeId).toBeUndefined();
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

  it("omits the None trip option in edit mode since the PATCH cannot detach a trip", () => {
    tripsStoreTrips.value = [
      { id: "trip-1", name: "Iceland Ring Road", status: "ongoing" },
    ];
    const labels = mountEdit()
      .find(".pill-pick")
      .findAll(".pick")
      .map((pick) => pick.text());
    expect(labels).toContain("Iceland Ring Road");
    expect(labels).not.toContain("None");
  });

  it("keeps an edit-shaped payload when the entry prop clears mid-save", async () => {
    // A slow places fetch keeps publish awaiting inside its try block, giving
    // the parent a window to null the entry (e.g. ⌘K opens a new entry) before
    // the payload is built. The mode was snapshotted, so a cleared body must
    // still be sent verbatim rather than dropped as it would be in create shape.
    mockUpdateEntry.mockResolvedValue(SAMPLE_ENTRY);
    mockFetchEntries.mockResolvedValue({
      entries: [],
      tab: "timeline",
      page: 1,
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
    await wrapper.find("textarea").setValue("");

    await wrapper.find(".drawer__foot .btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.setProps({ entry: null });

    settleFirstFetch();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockUpdateEntry).toHaveBeenCalledOnce();
    expect(mockCreateEntry).not.toHaveBeenCalled();
    const [, payload] = mockUpdateEntry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.body).toBe("");
  });
});
