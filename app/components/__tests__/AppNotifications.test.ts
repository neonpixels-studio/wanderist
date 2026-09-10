import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import AppNotifications from "../AppNotifications.vue";
import type { AppNotification } from "~/composables/useNotifications";

// Mutable refs so per-test overrides work without re-stubbing the global
// after each test. The component calls useNotifications() as a Nuxt
// auto-import global, so vi.stubGlobal is the correct intercept point.
const notificationsRef = ref<AppNotification[]>([]);
const isLoadingRef = ref(false);
const errorRef = ref<string | null>(null);
const dismissingIdsRef = ref<Set<string>>(new Set());
const mockMarkAllRead = vi.fn();
const mockMarkRead = vi.fn();
const mockDismissNotification = vi.fn();
const mockFetchNotifications = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal("useNotifications", () => ({
  notifications: notificationsRef,
  isLoading: isLoadingRef,
  error: errorRef,
  dismissingIds: dismissingIdsRef,
  unreadCount: 0,
  fetchNotifications: mockFetchNotifications,
  markAllRead: mockMarkAllRead,
  markRead: mockMarkRead,
  dismissNotification: mockDismissNotification,
}));

const SAMPLE_NOTIFICATIONS: AppNotification[] = [
  {
    id: "n-1",
    type: "import_ready",
    tone: "info",
    body: "12 geotagged photos from Lisbon are ready to import",
    isRead: false,
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    actor: null,
  },
  {
    id: "n-2",
    type: "like",
    tone: "accent",
    body: "elsa_far liked your entry",
    isRead: false,
    createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    actor: null,
  },
  {
    id: "n-3",
    type: "new_follower",
    tone: "accent",
    body: "Someone started following you",
    isRead: true,
    createdAt: new Date(Date.now() - 4 * 86400 * 1000).toISOString(),
    actor: {
      id: "user-elsa",
      displayName: "Elsa Farsdottir",
      handle: "elsa_far",
    },
  },
];

const iconStub = { template: "<svg data-icon />" };
const linkStub = { template: "<a><slot /></a>", props: ["to"] };

const globalConfig = {
  global: {
    stubs: {
      AppIcon: iconStub,
      NuxtLink: linkStub,
    },
  },
};

describe("AppNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkAllRead.mockResolvedValue(undefined);
    mockMarkRead.mockResolvedValue(undefined);
    mockDismissNotification.mockResolvedValue(undefined);
    notificationsRef.value = [...SAMPLE_NOTIFICATIONS];
    isLoadingRef.value = false;
    errorRef.value = null;
    dismissingIdsRef.value = new Set();
  });

  it("renders nothing when closed", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: false },
      ...globalConfig,
    });
    expect(wrapper.find(".notif").exists()).toBe(false);
  });

  it("renders the panel when open and matches snapshot", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.find(".notif").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders notification items from the composable", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.findAll(".notif__item")).toHaveLength(3);
  });

  it("marks unread items with is-unread class", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.findAll(".notif__item.is-unread")).toHaveLength(2);
  });

  it("calls composable markAllRead when mark all read is clicked", async () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    await wrapper.find(".notif__mark").trigger("click");
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("calls composable markRead when an unread notification's body is clicked", async () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const unreadBody = wrapper
      .findAll(".notif__item.is-unread")[0]
      ?.find(".notif__body");
    await unreadBody?.trigger("click");
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
    expect(mockMarkRead).toHaveBeenCalledWith("n-1");
  });

  it("does not call composable markRead when an already-read notification's body is clicked", async () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const readItem = wrapper
      .findAll(".notif__item")
      .find((item) => !item.classes("is-unread"));
    await readItem?.find(".notif__body").trigger("click");
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it("calls composable markRead when Enter or Space is pressed on an unread notification's body", async () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const unreadBody = wrapper
      .findAll(".notif__item.is-unread")[0]
      ?.find(".notif__body");
    await unreadBody?.trigger("keydown.enter");
    await unreadBody?.trigger("keydown.space");
    expect(mockMarkRead).toHaveBeenCalledTimes(2);
    expect(mockMarkRead).toHaveBeenCalledWith("n-1");
  });

  it("marks unread items' body as a keyboard-focusable button and read items' as neither", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const unreadBody = wrapper
      .findAll(".notif__item.is-unread")[0]
      ?.find(".notif__body");
    const readBody = wrapper
      .findAll(".notif__item")
      .find((item) => !item.classes("is-unread"))
      ?.find(".notif__body");
    expect(unreadBody?.attributes("tabindex")).toBe("0");
    expect(unreadBody?.attributes("role")).toBe("button");
    expect(readBody?.attributes("tabindex")).toBeUndefined();
    expect(readBody?.attributes("role")).toBeUndefined();
  });

  it("does not nest the dismiss button inside the body's role=button (avoids nested-interactive controls)", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const unreadItem = wrapper.findAll(".notif__item.is-unread")[0];
    expect(unreadItem?.find(".notif__body .notif__dismiss").exists()).toBe(
      false,
    );
    expect(unreadItem?.find(".notif__dismiss").exists()).toBe(true);
  });

  it("renders the header with Notifications title", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.find(".notif__head b").text()).toBe("Notifications");
  });

  it("renders the view all activity footer link", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.find(".notif__foot").exists()).toBe(true);
    expect(wrapper.find(".notif__foot").text()).toContain("View all activity");
  });

  it("renders the follower's display name for a new_follower notification with a resolved actor", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.text()).toContain("Elsa Farsdottir started following you");
  });

  it("falls back to the generic body when a new_follower notification has no actor", () => {
    notificationsRef.value = [
      {
        id: "n-4",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
        isRead: false,
        createdAt: new Date().toISOString(),
        actor: null,
      },
    ];
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.text()).toContain("Someone started following you");
  });

  it("renders tone classes for notifications", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.find(".notif__ico--info").exists()).toBe(true);
    expect(wrapper.find(".notif__ico--accent").exists()).toBe(true);
  });

  it("renders the loading state when isLoading is true and list is empty", () => {
    notificationsRef.value = [];
    isLoadingRef.value = true;

    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.find(".notif__list").text()).toContain("Loading");
  });

  it("renders the error state when error is set", () => {
    notificationsRef.value = [];
    errorRef.value = "Could not load notifications";

    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toContain(
      "Could not load notifications",
    );
  });

  it("renders a dismiss button on every notification item", () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    expect(wrapper.findAll(".notif__dismiss")).toHaveLength(3);
  });

  it("calls composable dismissNotification when the dismiss button is clicked", async () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const dismissButton = wrapper.findAll(".notif__dismiss")[0];
    await dismissButton?.trigger("click");
    expect(mockDismissNotification).toHaveBeenCalledTimes(1);
    expect(mockDismissNotification).toHaveBeenCalledWith("n-1");
  });

  it("does not call composable markRead when the dismiss button on an unread item is clicked", async () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const dismissButton = wrapper.findAll(".notif__dismiss")[0];
    await dismissButton?.trigger("click");
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it("does not call composable markRead when Enter or Space is pressed on the dismiss button of an unread item", async () => {
    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const dismissButton = wrapper.findAll(".notif__dismiss")[0];
    await dismissButton?.trigger("keydown.enter");
    await dismissButton?.trigger("keydown.space");
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it("disables the dismiss button while that notification's dismissal is in flight", () => {
    dismissingIdsRef.value = new Set(["n-1"]);

    const wrapper = mount(AppNotifications, {
      props: { open: true },
      ...globalConfig,
    });
    const dismissButtons = wrapper.findAll(".notif__dismiss");
    expect(dismissButtons[0]?.attributes("disabled")).toBeDefined();
    expect(dismissButtons[1]?.attributes("disabled")).toBeUndefined();
  });
});
