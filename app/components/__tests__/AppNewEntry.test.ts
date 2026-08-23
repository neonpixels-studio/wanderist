import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import AppNewEntry from "../AppNewEntry.vue";
import type { EntryDraft } from "~/composables/useEntryDraft";

const iconStub = { template: "<svg data-icon />" };

// ── Store + composable stubs ──────────────────────────────────────────────────

const mockCreateEntry = vi.fn();
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

vi.stubGlobal("useEntriesStore", () => ({
  createEntry: mockCreateEntry,
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

// isLoading is a plain boolean here because Pinia unwraps store refs on
// access; the drawer reads `placesStore.isLoading` as a boolean, not a ref.
vi.stubGlobal("usePlacesStore", () => ({
  places: placesStorePlaces.value,
  fetchPlaces: mockFetchPlaces,
  isLoading: false,
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("AppNewEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tripsStoreTrips.value = [];
    placesStorePlaces.value = [];
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

    expect(wrapper.find(".error-hint").text()).toContain("Server error");
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
    expect(wrapper.find(".error-hint").exists()).toBe(false);
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
    expect(wrapper.find(".error-hint").exists()).toBe(true);

    // Second upload succeeds — error should clear
    const successFile = new File(["ok"], "ok.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput.element, "files", {
      value: [successFile],
      configurable: true,
    });
    await fileInput.trigger("change");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".error-hint").exists()).toBe(false);
  });
});
