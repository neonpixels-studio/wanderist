import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import ActivityPage from "../activity.vue";
import { pageGlobalConfig as globalConfig } from "./test-utils";
import type { AppNotification } from "~/composables/useNotifications";

// Mutable refs allow per-test overrides without re-stubbing the global.
// The component calls useNotifications() as a Nuxt auto-import global,
// so vi.stubGlobal is the correct intercept point.
const notificationsRef = ref<AppNotification[]>([]);
const isLoadingRef = ref(false);
const errorRef = ref<string | null>(null);
const dismissingIdsRef = ref<Set<string>>(new Set());
const mockFetchAllNotifications = vi.fn().mockResolvedValue(undefined);
const mockDismissNotification = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal("useNotifications", () => ({
  notifications: notificationsRef,
  isLoading: isLoadingRef,
  error: errorRef,
  dismissingIds: dismissingIdsRef,
  unreadCount: 0,
  fetchAllNotifications: mockFetchAllNotifications,
  markAllRead: vi.fn().mockResolvedValue(undefined),
  dismissNotification: mockDismissNotification,
}));

const SAMPLE_NOTIFICATIONS: AppNotification[] = [
  {
    id: "n-1",
    type: "new_follower",
    tone: "accent",
    body: "Someone started following you",
    isRead: false,
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    actor: null,
  },
  {
    id: "n-2",
    type: "like",
    tone: "accent",
    body: "Someone liked your entry",
    isRead: true,
    createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    actor: null,
  },
];

describe("Activity page (/activity)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAllNotifications.mockResolvedValue(undefined);
    // Mirrors the real composable's effect (filters the dismissed id out of
    // the shared list) so focus-restore assertions see the post-dismiss DOM.
    mockDismissNotification.mockImplementation(async (id: string) => {
      notificationsRef.value = notificationsRef.value.filter(
        (notification) => notification.id !== id,
      );
    });
    notificationsRef.value = [...SAMPLE_NOTIFICATIONS];
    isLoadingRef.value = false;
    errorRef.value = null;
    dismissingIdsRef.value = new Set();
  });

  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.find(".content").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders notification items from useNotifications", () => {
    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.findAll(".activity__item")).toHaveLength(2);
  });

  it("walks every notification page on mount so older ones are reachable", () => {
    mount(ActivityPage, globalConfig);
    expect(mockFetchAllNotifications).toHaveBeenCalledTimes(1);
  });

  it("renders notification body text", () => {
    const wrapper = mount(ActivityPage, globalConfig);
    const texts = wrapper
      .findAll(".activity__text")
      .map((element) => element.text());
    expect(texts).toContain("Someone started following you");
    expect(texts).toContain("Someone liked your entry");
  });

  it("renders the follower's display name when a new_follower notification has a resolved actor", () => {
    notificationsRef.value = [
      {
        id: "n-3",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
        isRead: false,
        createdAt: new Date().toISOString(),
        actor: {
          id: "user-elsa",
          displayName: "Elsa Farsdottir",
          handle: "elsa_far",
        },
      },
    ];

    const wrapper = mount(ActivityPage, globalConfig);
    const texts = wrapper
      .findAll(".activity__text")
      .map((element) => element.text());
    expect(texts).toContain("Elsa Farsdottir started following you");
  });

  it("shows unread dot only for unread notifications", () => {
    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.findAll(".activity__dot")).toHaveLength(1);
    expect(wrapper.findAll(".activity__item.is-unread")).toHaveLength(1);
  });

  it("shows loading state when isLoading is true and list is empty", () => {
    notificationsRef.value = [];
    isLoadingRef.value = true;

    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.find(".activity__state").text()).toContain("Loading");
  });

  it("shows the full-page error state when error is set and no notifications have loaded", () => {
    notificationsRef.value = [];
    errorRef.value = "Could not load notifications";

    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toContain(
      "Could not load notifications",
    );
    expect(wrapper.find(".activity__list").exists()).toBe(false);
  });

  it("shows an error banner without hiding an already-loaded list (e.g. a failed dismiss)", () => {
    errorRef.value = "Could not dismiss notification";

    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toContain(
      "Could not dismiss notification",
    );
    expect(wrapper.find(".activity__list").exists()).toBe(true);
    expect(wrapper.findAll(".activity__item")).toHaveLength(2);
  });

  it("shows empty state when there are no notifications", () => {
    notificationsRef.value = [];

    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.find(".activity__state").text()).toContain(
      "No activity yet",
    );
  });

  it("renders a dismiss button on every notification item", () => {
    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.findAll(".activity__dismiss")).toHaveLength(2);
  });

  it("calls composable dismissNotification when the dismiss button is clicked", async () => {
    const wrapper = mount(ActivityPage, globalConfig);
    const dismissButton = wrapper.findAll(".activity__dismiss")[0];
    await dismissButton?.trigger("click");
    expect(mockDismissNotification).toHaveBeenCalledTimes(1);
    expect(mockDismissNotification).toHaveBeenCalledWith("n-1");
  });

  it("disables the dismiss button while that notification's dismissal is in flight", () => {
    dismissingIdsRef.value = new Set(["n-1"]);

    const wrapper = mount(ActivityPage, globalConfig);
    const dismissButtons = wrapper.findAll(".activity__dismiss");
    expect(dismissButtons[0]?.attributes("disabled")).toBeDefined();
    expect(dismissButtons[1]?.attributes("disabled")).toBeUndefined();
  });

  describe("keyboard focus after dismiss", () => {
    beforeEach(() => {
      notificationsRef.value = [
        ...SAMPLE_NOTIFICATIONS,
        {
          id: "n-3",
          type: "like",
          tone: "accent",
          body: "Someone else liked your entry",
          isRead: true,
          createdAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
          actor: null,
        },
      ];
    });

    it("moves focus to the next row's dismiss button when a focused middle row is dismissed", async () => {
      const wrapper = mount(ActivityPage, {
        ...globalConfig,
        attachTo: document.body,
      });
      const dismissButtons = wrapper.findAll(".activity__dismiss");
      dismissButtons[0]?.element.focus();
      expect(document.activeElement).toBe(dismissButtons[0]?.element);

      await dismissButtons[0]?.trigger("click");
      await flushPromises();

      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(
        wrapper.findAll(".activity__dismiss")[0]?.element,
      );
      wrapper.unmount();
    });

    it("moves focus to the previous row's dismiss button when the focused last row is dismissed", async () => {
      const wrapper = mount(ActivityPage, {
        ...globalConfig,
        attachTo: document.body,
      });
      const dismissButtons = wrapper.findAll(".activity__dismiss");
      const lastButton = dismissButtons[dismissButtons.length - 1];
      lastButton?.element.focus();

      await lastButton?.trigger("click");
      await flushPromises();

      const remainingButtons = wrapper.findAll(".activity__dismiss");
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(
        remainingButtons[remainingButtons.length - 1]?.element,
      );
      wrapper.unmount();
    });

    it("falls back to the list container when dismissing the only (focused) row", async () => {
      notificationsRef.value = [SAMPLE_NOTIFICATIONS[0] as AppNotification];

      const wrapper = mount(ActivityPage, {
        ...globalConfig,
        attachTo: document.body,
      });
      const dismissButton = wrapper.find(".activity__dismiss");
      dismissButton.element.focus();

      await dismissButton.trigger("click");
      await flushPromises();

      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(wrapper.find(".content").element);
      wrapper.unmount();
    });

    it("does not steal focus when the dismissed row's button was not focused", async () => {
      const outsideButton = document.createElement("button");
      document.body.appendChild(outsideButton);
      outsideButton.focus();

      const wrapper = mount(ActivityPage, {
        ...globalConfig,
        attachTo: document.body,
      });
      const dismissButton = wrapper.find(".activity__dismiss");

      await dismissButton.trigger("click");
      await flushPromises();

      expect(document.activeElement).toBe(outsideButton);
      wrapper.unmount();
      outsideButton.remove();
    });
  });
});
