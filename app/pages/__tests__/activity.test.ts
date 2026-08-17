import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import ActivityPage from "../activity.vue";
import { pageGlobalConfig as globalConfig } from "./test-utils";
import type { AppNotification } from "~/composables/useNotifications";

// Mutable refs allow per-test overrides without re-stubbing the global.
// The component calls useNotifications() as a Nuxt auto-import global,
// so vi.stubGlobal is the correct intercept point.
const notificationsRef = ref<AppNotification[]>([]);
const isLoadingRef = ref(false);
const errorRef = ref<string | null>(null);
const mockFetchAllNotifications = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal("useNotifications", () => ({
  notifications: notificationsRef,
  isLoading: isLoadingRef,
  error: errorRef,
  unreadCount: 0,
  fetchAllNotifications: mockFetchAllNotifications,
  markAllRead: vi.fn().mockResolvedValue(undefined),
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
    notificationsRef.value = [...SAMPLE_NOTIFICATIONS];
    isLoadingRef.value = false;
    errorRef.value = null;
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

  it("shows error state when error is set", () => {
    notificationsRef.value = [];
    errorRef.value = "Could not load notifications";

    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toContain(
      "Could not load notifications",
    );
  });

  it("shows empty state when there are no notifications", () => {
    notificationsRef.value = [];

    const wrapper = mount(ActivityPage, globalConfig);
    expect(wrapper.find(".activity__state").text()).toContain(
      "No activity yet",
    );
  });
});
