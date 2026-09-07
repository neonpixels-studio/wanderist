import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, reactive, nextTick, unref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import GuideDetailPage from "../guides/[id].vue";
import { nuxtLinkStub } from "~/components/__tests__/input-stubs";
import { useGuidesStore } from "~/stores/guides";
import type { Guide } from "~/stores/guides";

// Override the global useRoute stub with a REACTIVE params object so a test can
// change the guide id and assert the page's watched ref tracks it.
const routeParams = reactive({ id: "guide-1" });
vi.stubGlobal("useRoute", () => ({ params: routeParams, query: {} }));

// The global useAsyncData stub never invokes its handler, so by default the
// page's fetch wiring is dead under test. Override it to run the handler once
// and record its options so tests can assert the guide is requested by its
// route param and that the refetch-on-id-change watcher targets the id.
// `asyncDataStatus` lets a test simulate the pre-resolution window the page
// treats as loading.
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
    return {
      data: ref(null),
      pending: ref(false),
      error: ref(null),
      status: asyncDataStatus,
      refresh: mockRefresh,
    };
  },
);

const SAMPLE_GUIDE: Guide = {
  id: "guide-1",
  userId: "user-1",
  title: "Tokyo on foot",
  body: "Start in Yanaka at sunrise.\n\nEnd at the river by dusk.",
  readTimeMinutes: 8,
  likeCount: 12,
  visibility: "public",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const alertStub = {
  props: ["intent", "message"],
  template: '<div class="alert-stub" :data-message="message" />',
};

function buildGlobalConfig(pinia: ReturnType<typeof createPinia>) {
  return {
    global: {
      plugins: [pinia],
      stubs: {
        AppIcon: { template: "<svg data-icon />" },
        NuxtLink: nuxtLinkStub,
        AppAlert: alertStub,
      },
    },
  };
}

describe("Guide Detail page (/guides/[id])", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    routeParams.id = "guide-1";
    asyncDataStatus.value = "success";
    mockRefresh.mockClear();
    pinia = createPinia();
    setActivePinia(pinia);

    const guidesStore = useGuidesStore();
    guidesStore.currentGuide = { ...SAMPLE_GUIDE };
    vi.spyOn(guidesStore, "fetchGuideById").mockResolvedValue();
  });

  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".gdetail").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the guide title", () => {
    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".gdetail__head h1").text()).toBe("Tokyo on foot");
  });

  it("renders the guide body", () => {
    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".gdetail__body").text()).toContain(
      "Start in Yanaka at sunrise.",
    );
  });

  it("renders the read time", () => {
    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.text()).toContain("8 min read");
  });

  it("requests the guide named by the route param", () => {
    const guidesStore = useGuidesStore();
    mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(guidesStore.fetchGuideById).toHaveBeenCalledWith("guide-1");
  });

  it("fetches client-only (server:false) so the token-bearing request never runs during SSR", () => {
    mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(lastAsyncDataOptions?.server).toBe(false);
  });

  it("watches the guide id so it refetches on in-page navigation", async () => {
    mount(GuideDetailPage, buildGlobalConfig(pinia));

    // The watched ref must be the guide id (not, say, the loaded guide) so the
    // component refetches when navigating between two guides reuses it.
    const watchedGuideId = lastAsyncDataOptions?.watch?.[0];
    expect(unref(watchedGuideId)).toBe("guide-1");

    routeParams.id = "guide-2";
    await nextTick();

    expect(unref(watchedGuideId)).toBe("guide-2");
  });

  it("does not render a stale guide whose id no longer matches the route", async () => {
    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.find(".gdetail__head h1").text()).toBe("Tokyo on foot");

    // Navigate to a different id before the refetch replaces currentGuide.
    routeParams.id = "guide-2";
    await nextTick();

    expect(wrapper.find(".gdetail__head h1").exists()).toBe(false);
  });

  it("shows the loading state while the guide is loading", () => {
    const guidesStore = useGuidesStore();
    guidesStore.isLoadingGuide = true;

    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.text()).toContain("Loading guide…");
  });

  it("shows loading (not the not-found state) before the client fetch resolves", () => {
    // server:false means no guide exists during the pre-resolution window; the
    // page must render loading, never flash "Guide not found" for a valid guide.
    asyncDataStatus.value = "pending";
    const guidesStore = useGuidesStore();
    guidesStore.currentGuide = null;
    guidesStore.isLoadingGuide = false;

    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.text()).toContain("Loading guide…");
    expect(wrapper.text()).not.toContain("Guide not found");
  });

  it("surfaces the store error message on a retryable failure (5xx/network), not the not-found state", () => {
    const guidesStore = useGuidesStore();
    guidesStore.currentGuide = null;
    guidesStore.guideNotFound = false;
    guidesStore.guideError = "Something went wrong";

    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.find(".alert-stub").attributes("data-message")).toBe(
      "Something went wrong",
    );
    expect(wrapper.text()).not.toContain("Guide not found");
    expect(wrapper.text()).toContain("try again");
  });

  it("retries the fetch when 'try again' is clicked on the error state", async () => {
    const guidesStore = useGuidesStore();
    guidesStore.currentGuide = null;
    guidesStore.guideNotFound = false;
    guidesStore.guideError = "Something went wrong";

    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    await wrapper.find("button").trigger("click");

    expect(mockRefresh).toHaveBeenCalled();
  });

  it("offers a back-to-guides link in the retryable error state too, so a visitor isn't stranded on a retry that keeps failing", () => {
    const guidesStore = useGuidesStore();
    guidesStore.currentGuide = null;
    guidesStore.guideNotFound = false;
    guidesStore.guideError = "Something went wrong";

    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));

    expect(
      wrapper
        .findAll("a")
        .some((link) => link.text().includes("back to guides")),
    ).toBe(true);
  });

  it("shows the not-found state (not the error alert) when no guide is loaded", () => {
    const guidesStore = useGuidesStore();
    guidesStore.currentGuide = null;

    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.text()).toContain("Guide not found.");
    expect(wrapper.find(".alert-stub").exists()).toBe(false);
  });

  it("shows the not-found state for a 404 rather than the retryable error state", () => {
    const guidesStore = useGuidesStore();
    guidesStore.currentGuide = null;
    guidesStore.guideNotFound = true;
    guidesStore.guideError = null;

    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));

    expect(wrapper.text()).toContain("Guide not found.");
    expect(wrapper.find(".alert-stub").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("try again");
  });

  it("shows a placeholder when the guide has no body", () => {
    const guidesStore = useGuidesStore();
    guidesStore.currentGuide = { ...SAMPLE_GUIDE, body: null };

    const wrapper = mount(GuideDetailPage, buildGlobalConfig(pinia));
    expect(wrapper.text()).toContain("This guide has no content yet.");
  });
});
