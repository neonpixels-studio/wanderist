import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import AppCommandPalette from "../AppCommandPalette.vue";

// navigateTo is stubbed globally in vitest.setup.ts; cast for spy access
const mockNavigateTo = navigateTo as ReturnType<typeof vi.fn>;

const iconStub = { template: "<svg data-icon />" };
const linkStub = { template: "<a><slot /></a>", props: ["to"] };

// Reactive search state shared across tests
const mockQuery = ref("");
const mockResults = ref({
  places: [],
  trips: [],
  entries: [],
  guides: [],
  people: [],
});
const mockIsLoading = ref(false);
const mockError = ref<string | null>(null);
const mockSearch = vi.fn();
const mockOpenNewEntry = vi.fn();

vi.stubGlobal("useSearch", () => ({
  query: mockQuery,
  results: mockResults,
  isLoading: mockIsLoading,
  error: mockError,
  search: mockSearch,
}));

const globalConfig = {
  global: {
    stubs: {
      AppIcon: iconStub,
      NuxtLink: linkStub,
    },
    provide: {
      openNewEntry: mockOpenNewEntry,
    },
  },
};

describe("AppCommandPalette", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQuery.value = "";
    mockResults.value = {
      places: [],
      trips: [],
      entries: [],
      guides: [],
      people: [],
    };
    mockIsLoading.value = false;
    mockError.value = null;
    mockOpenNewEntry.mockReset();
  });

  it("renders nothing when closed", () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: false },
      ...globalConfig,
    });
    expect(wrapper.find(".cmdk").exists()).toBe(false);
  });

  it("renders the panel when open and matches snapshot", () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.find(".cmdk").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows only quick actions when query is empty", () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });
    const labels = wrapper.findAll(".cmdk__glabel").map((el) => el.text());
    expect(labels).toEqual(["Quick actions"]);
  });

  it("shows 5 quick action items by default", () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.findAll(".cmdk__item")).toHaveLength(5);
  });

  it("New entry quick action calls openNewEntry and emits close on click", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    // "New entry" renders as a <button> (action item, not a NuxtLink)
    const newEntryButton = wrapper
      .findAll("button.cmdk__item")
      .find((button) => button.text().includes("New entry"));

    expect(newEntryButton).toBeDefined();
    await newEntryButton!.trigger("click");

    expect(mockOpenNewEntry).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("Enter key activates the highlighted action item and emits close", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    // "New entry" is the first quick action (index 0, highlighted by default)
    await wrapper.find(".cmdk").trigger("keydown", { key: "Enter" });

    expect(mockOpenNewEntry).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("Enter key navigates to href for a highlighted link item", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    // Move highlight to index 1 ("Drop a pin" → href "/map")
    await wrapper.find(".cmdk").trigger("keydown", { key: "ArrowDown" });
    await wrapper.find(".cmdk").trigger("keydown", { key: "Enter" });

    expect(mockNavigateTo).toHaveBeenCalledWith("/map");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("shows API search results when query is typed", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    // Simulate a search returning place results
    mockSearch.mockImplementation(() => {
      mockResults.value = {
        places: [
          {
            id: "p-1",
            title: "Reykjavík",
            subtitle: "Iceland",
            icon: "pin",
            href: "/map",
          },
        ],
        trips: [],
        entries: [],
        guides: [],
        people: [],
      };
    });

    await wrapper.find(".cmdk__input").setValue("reyk");
    // Trigger the watch manually (watch fires synchronously in happy-dom)
    await wrapper.vm.$nextTick();

    expect(mockSearch).toHaveBeenCalledWith("reyk");
    expect(wrapper.findAll(".cmdk__item")).toHaveLength(1);
    expect(wrapper.find(".cmdk__t").text()).toContain("Reykjavík");
  });

  it("escapes HTML in result titles so a malicious title renders inert", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    const payload = "<img src=x onerror=alert(1)>";
    mockSearch.mockImplementation(() => {
      mockResults.value = {
        places: [{ id: "p-1", title: payload, icon: "pin", href: "/map" }],
        trips: [],
        entries: [],
        guides: [],
        people: [],
      };
    });

    // Query substring of the payload to exercise the <mark> highlight branch.
    await wrapper.find(".cmdk__input").setValue("img");
    await flushPromises();
    await wrapper.vm.$nextTick();

    const titleEl = wrapper.find(".cmdk__t");
    // No live <img> element is injected — the payload is inert text.
    expect(titleEl.find("img").exists()).toBe(false);
    expect(titleEl.element.querySelector("img")).toBeNull();
    // The angle brackets are escaped, so the only live element is the highlight
    // <mark> we add; the payload never becomes a tag.
    expect(titleEl.html()).toContain("&lt;");
    expect(titleEl.html()).toContain("&gt;");
    expect(titleEl.html()).not.toContain("<img");
    expect(titleEl.text()).toBe(payload);
    // The matched substring is still wrapped in a highlight mark.
    expect(titleEl.find("mark").text()).toBe("img");
  });

  it("escapes HTML in result titles even when the query does not match (no highlight branch)", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    const payload = "<img src=x onerror=alert(1)>";
    mockSearch.mockImplementation(() => {
      mockResults.value = {
        places: [{ id: "p-1", title: payload, icon: "pin", href: "/map" }],
        trips: [],
        entries: [],
        guides: [],
        people: [],
      };
    });

    // Query matches nothing in the title, so highlight() takes the no-match
    // early return — that branch must still escape the raw title.
    await wrapper.find(".cmdk__input").setValue("zzznomatch");
    await flushPromises();
    await wrapper.vm.$nextTick();

    const titleEl = wrapper.find(".cmdk__t");
    expect(titleEl.element.querySelector("img")).toBeNull();
    expect(titleEl.html()).not.toContain("<img");
    expect(titleEl.text()).toBe(payload);
    expect(titleEl.find("mark").exists()).toBe(false);
  });

  it("escapes HTML inside the highlighted match itself", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    mockSearch.mockImplementation(() => {
      mockResults.value = {
        places: [
          { id: "p-1", title: "Bar & <b>Grill</b>", icon: "pin", href: "/map" },
        ],
        trips: [],
        entries: [],
        guides: [],
        people: [],
      };
    });

    // The matched substring itself contains markup — it must be escaped, not
    // just the slices around it, or the highlight branch reintroduces the XSS.
    await wrapper.find(".cmdk__input").setValue("& <b>");
    await flushPromises();
    await wrapper.vm.$nextTick();

    const titleEl = wrapper.find(".cmdk__t");
    expect(titleEl.find("mark").html()).toBe("<mark>&amp; &lt;b&gt;</mark>");
    expect(titleEl.element.querySelector("b")).toBeNull();
    expect(titleEl.text()).toBe("Bar & <b>Grill</b>");
  });

  it("treats regex metacharacters in the query as literal text", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    mockSearch.mockImplementation(() => {
      mockResults.value = {
        places: [
          { id: "p-1", title: "Café (Reykjavík)", icon: "pin", href: "/map" },
        ],
        trips: [],
        entries: [],
        guides: [],
        people: [],
      };
    });

    await wrapper.find(".cmdk__input").setValue("(rey");
    await flushPromises();
    await wrapper.vm.$nextTick();

    // The "(" is escaped for regex, so it matches the literal "(Rey" substring.
    expect(wrapper.find(".cmdk__t").find("mark").text()).toBe("(Rey");
  });

  it("renders without crashing when the query is a lone regex metacharacter", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    mockSearch.mockImplementation(() => {
      mockResults.value = {
        places: [{ id: "p-1", title: "Reykjavík", icon: "pin", href: "/map" }],
        trips: [],
        entries: [],
        guides: [],
        people: [],
      };
    });

    // An unbalanced "(" would throw in `new RegExp("(")` without escaping,
    // blanking the palette. It must be treated as a literal (no match here).
    await wrapper.find(".cmdk__input").setValue("(");
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".cmdk").exists()).toBe(true);
    expect(wrapper.find(".cmdk__t").text()).toBe("Reykjavík");
    expect(wrapper.find(".cmdk__t").find("mark").exists()).toBe(false);
  });

  it("shows results from multiple groups when API returns results in several categories", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    // Simulate a search populating both places and trips
    mockSearch.mockImplementation(() => {
      mockResults.value = {
        places: [{ id: "p-1", title: "Reykjavík", icon: "pin", href: "/map" }],
        trips: [
          {
            id: "t-1",
            title: "Iceland trip",
            icon: "route",
            href: "/trips/t-1",
          },
        ],
        entries: [],
        guides: [],
        people: [],
      };
    });

    await wrapper.find(".cmdk__input").setValue("ice");
    await flushPromises();
    await wrapper.vm.$nextTick();

    const labels = wrapper.findAll(".cmdk__glabel").map((el) => el.text());
    expect(labels).toContain("Places");
    expect(labels).toContain("Trips");
  });

  it("renders the Guides group when API returns guide results", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    mockSearch.mockImplementation(() => {
      mockResults.value = {
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
    });

    await wrapper.find(".cmdk__input").setValue("kyoto");
    await flushPromises();
    await wrapper.vm.$nextTick();

    const guidesGroup = wrapper
      .findAll(".cmdk__group")
      .find((group) => group.find(".cmdk__glabel").text() === "Guides");
    expect(guidesGroup).toBeDefined();
    expect(guidesGroup?.find(".cmdk__t").text()).toContain("48 hours in Kyoto");
  });

  it("shows empty state when query is set but API returns no results", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    // mockSearch is vi.fn() (no-op after resetAllMocks), so mockResults stays empty.
    mockQuery.value = "zzznomatch";
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".cmdk__empty").exists()).toBe(true);
    expect(wrapper.find(".cmdk__empty").text()).toContain("zzznomatch");
  });

  it("emits close when scrim is clicked", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });
    await wrapper.find(".cmdk__scrim").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close on Escape key", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });
    await wrapper.find(".cmdk").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("moves active index down on ArrowDown", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });
    await wrapper.find(".cmdk").trigger("keydown", { key: "ArrowDown" });
    const items = wrapper.findAll(".cmdk__item");
    expect(items[1].classes()).toContain("is-active");
  });

  it("renders footer keyboard hints", () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.find(".cmdk__foot").exists()).toBe(true);
    expect(wrapper.find(".cmdk__brand").text()).toBe("wanderist");
  });

  it("calls search when input value changes", async () => {
    const wrapper = mount(AppCommandPalette, {
      props: { open: true },
      ...globalConfig,
    });

    await wrapper.find(".cmdk__input").setValue("tokyo");
    expect(mockSearch).toHaveBeenCalledWith("tokyo");
  });
});
