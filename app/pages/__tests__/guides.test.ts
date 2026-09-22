import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import GuidesPage from "../guides/index.vue";
import { useGuidesStore } from "~/stores/guides";
import type { Guide } from "~/stores/guides";
import {
  inputStub,
  textareaStub,
  nuxtLinkStub,
} from "~/components/__tests__/input-stubs";

const SAMPLE_GUIDES: Guide[] = [
  {
    id: "g-1",
    userId: "user-1",
    title: "Tokyo on foot",
    body: "Start in Yanaka at sunrise.",
    readTimeMinutes: 8,
    likeCount: 12,
    visibility: "public",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "g-2",
    userId: "user-1",
    title: "Slow coastlines",
    body: null,
    readTimeMinutes: 5,
    likeCount: 0,
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function buildGlobalConfig(pinia: ReturnType<typeof createPinia>) {
  return {
    global: {
      plugins: [pinia],
      stubs: {
        AppIcon: { template: "<svg data-icon />" },
        InputText: inputStub,
        InputTextarea: textareaStub,
        NuxtLink: nuxtLinkStub,
      },
    },
  };
}

describe("Guides page (/guides)", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    const guidesStore = useGuidesStore();
    guidesStore.guides = [...SAMPLE_GUIDES];
    // The real fetchGuides sets this once the initial load resolves; set it
    // directly here since fetchGuides itself is mocked out below.
    guidesStore.hasLoaded = true;
    vi.spyOn(guidesStore, "fetchGuides").mockResolvedValue();
  });

  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".guides-head").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("calls fetchGuides on mount", async () => {
    const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
    const guidesStore = useGuidesStore();
    await wrapper.vm.$nextTick();
    expect(guidesStore.fetchGuides).toHaveBeenCalledTimes(1);
  });

  it("renders a card for every guide", () => {
    const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
    expect(wrapper.findAll(".gcard")).toHaveLength(2);
  });

  it("shows the empty state when there are no guides and the initial load has finished", () => {
    const guidesStore = useGuidesStore();
    guidesStore.guides = [];
    const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".empty-note").exists()).toBe(true);
    expect(wrapper.text()).toContain("No guides yet");
  });

  it("shows a loading state instead of the empty state before the initial load resolves", () => {
    const guidesStore = useGuidesStore();
    guidesStore.guides = [];
    guidesStore.hasLoaded = false;
    guidesStore.isLoading = true;
    const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
    expect(wrapper.text()).toContain("Loading guides");
    expect(wrapper.text()).not.toContain("No guides yet");
  });

  it("shows neither state while genuinely not yet loaded and not loading (pre-mount tick)", () => {
    const guidesStore = useGuidesStore();
    guidesStore.guides = [];
    guidesStore.hasLoaded = false;
    guidesStore.isLoading = false;
    const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".empty-note").exists()).toBe(false);
  });

  it("does not show the empty state when the initial load failed", () => {
    const guidesStore = useGuidesStore();
    guidesStore.guides = [];
    guidesStore.hasLoaded = false;
    guidesStore.isLoading = false;
    guidesStore.error = "Failed to load guides";
    const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".alert--error").exists()).toBe(true);
    expect(wrapper.find(".empty-note").exists()).toBe(false);
  });

  it("retries the fetch when the retry button is clicked", async () => {
    const guidesStore = useGuidesStore();
    guidesStore.error = "Failed to load guides";
    const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));

    const retryButton = wrapper
      .findAll(".alert--error button")
      .find((button) => button.text() === "retry");
    await retryButton?.trigger("click");

    // Called once on mount and once from the retry click.
    expect(guidesStore.fetchGuides).toHaveBeenCalledTimes(2);
  });

  describe("new guide form", () => {
    it("shows the new guide form when the button is clicked", async () => {
      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      expect(wrapper.find(".guide-form").exists()).toBe(false);

      await wrapper.find(".guides-head button").trigger("click");

      expect(wrapper.find(".guide-form").exists()).toBe(true);
    });

    it("hides the form when cancel is clicked", async () => {
      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      await wrapper.find(".guides-head button").trigger("click");

      const cancelButton = wrapper
        .findAll(".guide-form button")
        .find((button) => button.text().includes("cancel"));
      await cancelButton?.trigger("click");

      expect(wrapper.find(".guide-form").exists()).toBe(false);
    });

    it("creates a guide with the entered title and closes the form", async () => {
      const guidesStore = useGuidesStore();
      const createdGuide: Guide = {
        ...SAMPLE_GUIDES[0],
        id: "g-new",
        title: "Patagonia loop",
      };
      vi.spyOn(guidesStore, "createGuide").mockResolvedValue(createdGuide);

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      await wrapper.find(".guides-head button").trigger("click");
      await wrapper
        .find('input[placeholder="Guide title…"]')
        .setValue("Patagonia loop");
      await wrapper.find(".guide-form form").trigger("submit");
      await flushPromises();

      expect(guidesStore.createGuide).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Patagonia loop" }),
      );
      expect(wrapper.find(".guide-form").exists()).toBe(false);
    });

    it("shows an error message when guide creation fails", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "createGuide").mockRejectedValue(
        new Error("Failed to create guide"),
      );

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      await wrapper.find(".guides-head button").trigger("click");
      await wrapper
        .find('input[placeholder="Guide title…"]')
        .setValue("Bad guide");
      await wrapper.find(".guide-form form").trigger("submit");
      await flushPromises();

      expect(wrapper.find(".guide-form__error").text()).toBe(
        "An unexpected error occurred",
      );
      expect(wrapper.find(".guide-form").exists()).toBe(true);
    });
  });

  describe("editing a guide", () => {
    it("shows an inline edit form pre-filled with the guide's fields", async () => {
      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      const editButtons = wrapper
        .findAll(".gcard__acts button")
        .filter((button) => button.text() === "edit");

      await editButtons[0].trigger("click");

      const titleInput = wrapper.find(
        'input[placeholder="Guide title…"]',
      ) as unknown as { element: HTMLInputElement };
      expect(titleInput.element.value).toBe("Tokyo on foot");
    });

    it("updates the guide and closes the edit form", async () => {
      const guidesStore = useGuidesStore();
      const updatedGuide: Guide = {
        ...SAMPLE_GUIDES[0],
        title: "Tokyo on foot, revised",
      };
      vi.spyOn(guidesStore, "updateGuide").mockResolvedValue(updatedGuide);

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      const editButtons = wrapper
        .findAll(".gcard__acts button")
        .filter((button) => button.text() === "edit");
      await editButtons[0].trigger("click");

      await wrapper
        .find('input[placeholder="Guide title…"]')
        .setValue("Tokyo on foot, revised");
      await wrapper.find(".guide-form form").trigger("submit");
      await flushPromises();

      expect(guidesStore.updateGuide).toHaveBeenCalledWith(
        "g-1",
        expect.objectContaining({ title: "Tokyo on foot, revised" }),
      );
      expect(wrapper.find(".guide-form").exists()).toBe(false);
    });
  });

  describe("deleting a guide", () => {
    function findButton(wrapper: ReturnType<typeof mount>, text: string) {
      return wrapper
        .findAll(".gcard__acts button")
        .find((button) => button.text() === text);
    }

    it("requires a confirm click before calling deleteGuide", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "deleteGuide").mockResolvedValue();

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      await findButton(wrapper, "delete")?.trigger("click");

      expect(guidesStore.deleteGuide).not.toHaveBeenCalled();
      expect(findButton(wrapper, "confirm delete")).toBeTruthy();
    });

    it("cancelling the confirm step does not call deleteGuide", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "deleteGuide").mockResolvedValue();

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      await findButton(wrapper, "delete")?.trigger("click");
      await findButton(wrapper, "cancel")?.trigger("click");

      expect(guidesStore.deleteGuide).not.toHaveBeenCalled();
      expect(findButton(wrapper, "delete")).toBeTruthy();
    });

    it("calls deleteGuide with the guide's id after confirming", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "deleteGuide").mockResolvedValue();

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      await findButton(wrapper, "delete")?.trigger("click");
      await findButton(wrapper, "confirm delete")?.trigger("click");
      await flushPromises();

      expect(guidesStore.deleteGuide).toHaveBeenCalledWith("g-1");
    });

    it("shows an error message when deletion fails", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "deleteGuide").mockRejectedValue(
        new Error("Failed to delete guide"),
      );

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      await findButton(wrapper, "delete")?.trigger("click");
      await findButton(wrapper, "confirm delete")?.trigger("click");
      await flushPromises();

      expect(wrapper.text()).toContain("An unexpected error occurred");
    });

    it("keeps the confirm step open after a failed delete so retry is one click away", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "deleteGuide").mockRejectedValue(
        new Error("Failed to delete guide"),
      );

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));
      await findButton(wrapper, "delete")?.trigger("click");
      await findButton(wrapper, "confirm delete")?.trigger("click");
      await flushPromises();

      const retryButton = findButton(wrapper, "confirm delete");
      expect(retryButton).toBeTruthy();

      await retryButton?.trigger("click");
      await flushPromises();

      expect(guidesStore.deleteGuide).toHaveBeenCalledTimes(2);
    });

    it("deleting one guide does not block confirming delete on a different guide", async () => {
      const guidesStore = useGuidesStore();
      let resolveFirstDelete: () => void = () => {};
      const firstDeletePromise = new Promise<void>((resolve) => {
        resolveFirstDelete = resolve;
      });
      vi.spyOn(guidesStore, "deleteGuide").mockImplementation((id) =>
        id === "g-1" ? firstDeletePromise : Promise.resolve(),
      );

      function findButtonInCard(cardIndex: number, text: string) {
        return wrapper
          .findAll(".gcard")
          [cardIndex]?.findAll("button")
          .find((button) => button.text() === text);
      }

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));

      // Start (but don't resolve) deleting the first guide.
      await findButtonInCard(0, "delete")?.trigger("click");
      await findButtonInCard(0, "confirm delete")?.trigger("click");

      // The second guide's delete must still go through while the first is
      // still in flight.
      await findButtonInCard(1, "delete")?.trigger("click");
      await findButtonInCard(1, "confirm delete")?.trigger("click");
      await flushPromises();

      expect(guidesStore.deleteGuide).toHaveBeenCalledWith("g-2");

      resolveFirstDelete();
      await flushPromises();
      expect(guidesStore.deleteGuide).toHaveBeenCalledWith("g-1");
    });
  });

  describe("liking a guide", () => {
    it("likes a guide on first click and marks it liked", async () => {
      const guidesStore = useGuidesStore();
      const likeSpy = vi
        .spyOn(guidesStore, "likeGuide")
        .mockResolvedValue({ ...SAMPLE_GUIDES[0], likeCount: 13 });

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));

      await wrapper.findAll(".gcard__like")[0].trigger("click");
      await flushPromises();

      expect(likeSpy).toHaveBeenCalledWith("g-1");
      expect(wrapper.findAll(".gcard__like")[0].classes()).toContain("liked");
    });

    it("unlikes a guide on the second click", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "likeGuide").mockResolvedValue({
        ...SAMPLE_GUIDES[0],
        likeCount: 13,
      });
      const unlikeSpy = vi
        .spyOn(guidesStore, "unlikeGuide")
        .mockResolvedValue({ ...SAMPLE_GUIDES[0], likeCount: 12 });

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));

      await wrapper.findAll(".gcard__like")[0].trigger("click");
      await flushPromises();
      await wrapper.findAll(".gcard__like")[0].trigger("click");
      await flushPromises();

      expect(unlikeSpy).toHaveBeenCalledWith("g-1");
      expect(wrapper.findAll(".gcard__like")[0].classes()).not.toContain(
        "liked",
      );
    });

    it("rolls back the liked state when the like request fails", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "likeGuide").mockRejectedValue(
        new Error("Not found"),
      );

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));

      await wrapper.findAll(".gcard__like")[0].trigger("click");
      await flushPromises();

      expect(wrapper.findAll(".gcard__like")[0].classes()).not.toContain(
        "liked",
      );
    });

    // Distinguishes the rollback from a constant `false`: after a successful
    // like, a failed unlike must restore the liked (true) state, not clear it.
    it("keeps the guide liked when the unlike request fails", async () => {
      const guidesStore = useGuidesStore();
      vi.spyOn(guidesStore, "likeGuide").mockResolvedValue({
        ...SAMPLE_GUIDES[0],
        likeCount: 13,
      });
      vi.spyOn(guidesStore, "unlikeGuide").mockRejectedValue(
        new Error("Not found"),
      );

      const wrapper = mount(GuidesPage, buildGlobalConfig(pinia));

      await wrapper.findAll(".gcard__like")[0].trigger("click");
      await flushPromises();
      await wrapper.findAll(".gcard__like")[0].trigger("click");
      await flushPromises();

      expect(wrapper.findAll(".gcard__like")[0].classes()).toContain("liked");
    });
  });
});
