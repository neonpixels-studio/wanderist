import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vue from "vue";

const mockApiFetch = vi.fn();

vi.stubGlobal("useState", <T>(_key: string, init?: () => T) =>
  vue.ref(init?.()),
);

vi.mock("~/composables/useApiClient", () => ({
  useApiClient: vi.fn(() => ({ apiFetch: mockApiFetch })),
}));

vi.mock("~/utils/extractErrorMessage", () => ({
  extractErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    return "An unexpected error occurred";
  }),
}));

const { useNotifications } = await import("../useNotifications");

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes notifications as an empty array", () => {
    const { notifications } = useNotifications();
    expect(notifications.value).toEqual([]);
  });

  it("fetchNotifications populates notifications from the API response", async () => {
    const sampleNotifications = [
      {
        id: "notif-1",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
        isRead: false,
        createdAt: "2024-06-01T10:00:00Z",
      },
    ];
    mockApiFetch.mockResolvedValue({
      notifications: sampleNotifications,
      page: 1,
      hasMore: false,
    });

    const { notifications, fetchNotifications } = useNotifications();
    await fetchNotifications();

    expect(notifications.value).toEqual(sampleNotifications);
  });

  it("fetchNotifications sets error on failure and does not throw", async () => {
    mockApiFetch.mockRejectedValue(new Error("Network error"));

    const { error, fetchNotifications } = useNotifications();

    await expect(fetchNotifications()).resolves.toBeUndefined();
    expect(error.value).toBeTruthy();
  });

  it("fetchNotifications clears the previous error on a successful fetch", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("Network error"));
    const { error, fetchNotifications } = useNotifications();
    await fetchNotifications();
    expect(error.value).toBeTruthy();

    mockApiFetch.mockResolvedValue({
      notifications: [],
      page: 1,
      hasMore: false,
    });
    await fetchNotifications();
    expect(error.value).toBeNull();
  });

  it("unreadCount returns the number of unread notifications", async () => {
    mockApiFetch.mockResolvedValue({
      notifications: [
        {
          id: "n-1",
          type: "like",
          tone: "accent",
          body: "Someone liked your entry",
          isRead: false,
          createdAt: "2024-06-01T10:00:00Z",
        },
        {
          id: "n-2",
          type: "new_follower",
          tone: "accent",
          body: "Someone started following you",
          isRead: true,
          createdAt: "2024-06-01T09:00:00Z",
        },
        {
          id: "n-3",
          type: "comment",
          tone: "accent",
          body: "Someone commented on your entry",
          isRead: false,
          createdAt: "2024-06-01T08:00:00Z",
        },
      ],
      page: 1,
      hasMore: false,
    });

    const { unreadCount, fetchNotifications } = useNotifications();
    await fetchNotifications();

    expect(unreadCount.value).toBe(2);
  });

  it("markAllRead calls POST /api/notifications/read-all and sets all isRead to true", async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        notifications: [
          {
            id: "n-1",
            type: "like",
            tone: "accent",
            body: "Liked",
            isRead: false,
            createdAt: "2024-06-01T10:00:00Z",
          },
          {
            id: "n-2",
            type: "comment",
            tone: "accent",
            body: "Comment",
            isRead: false,
            createdAt: "2024-06-01T09:00:00Z",
          },
        ],
        page: 1,
        hasMore: false,
      })
      .mockResolvedValueOnce({ ok: true });

    const { notifications, fetchNotifications, markAllRead } =
      useNotifications();
    await fetchNotifications();

    await markAllRead();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/notifications/read-all", {
      method: "POST",
    });
    expect(
      notifications.value.every((notification) => notification.isRead),
    ).toBe(true);
  });

  it("markAllRead sets error state when the API call fails", async () => {
    mockApiFetch.mockRejectedValue(new Error("Server error"));

    const { error, markAllRead } = useNotifications();

    await expect(markAllRead()).resolves.toBeUndefined();
    expect(error.value).toBeTruthy();
  });

  it("markRead calls POST /api/notifications/:id/read and marks only that notification isRead", async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        notifications: [
          {
            id: "n-1",
            type: "like",
            tone: "accent",
            body: "Liked",
            isRead: false,
            createdAt: "2024-06-01T10:00:00Z",
          },
          {
            id: "n-2",
            type: "comment",
            tone: "accent",
            body: "Comment",
            isRead: false,
            createdAt: "2024-06-01T09:00:00Z",
          },
        ],
        page: 1,
        hasMore: false,
      })
      .mockResolvedValueOnce({ ok: true });

    const { notifications, fetchNotifications, markRead } = useNotifications();
    await fetchNotifications();

    await markRead("n-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/notifications/n-1/read", {
      method: "POST",
    });
    expect(
      notifications.value.find((notification) => notification.id === "n-1")
        ?.isRead,
    ).toBe(true);
    expect(
      notifications.value.find((notification) => notification.id === "n-2")
        ?.isRead,
    ).toBe(false);
  });

  it("markRead sets error state when the API call fails", async () => {
    mockApiFetch.mockRejectedValue(new Error("Server error"));

    const { error, markRead } = useNotifications();

    await expect(markRead("n-1")).resolves.toBeUndefined();
    expect(error.value).toBeTruthy();
  });

  it("isLoading is false initially", () => {
    const { isLoading } = useNotifications();
    expect(isLoading.value).toBe(false);
  });

  it("fetchNotifications requests only the first page (the drawer's fast preview)", async () => {
    mockApiFetch.mockResolvedValue({
      notifications: [makeSample("n-1")],
      page: 1,
      hasMore: true,
    });

    const { notifications, fetchNotifications } = useNotifications();
    await fetchNotifications();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/notifications", {
      query: { page: 1 },
    });
    expect(notifications.value.map((notification) => notification.id)).toEqual([
      "n-1",
    ]);
  });

  it("fetchAllNotifications walks every page and concatenates them until hasMore is false", async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        notifications: [makeSample("n-1")],
        page: 1,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        notifications: [makeSample("n-2")],
        page: 2,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        notifications: [makeSample("n-3")],
        page: 3,
        hasMore: false,
      });

    const { notifications, fetchAllNotifications } = useNotifications();
    await fetchAllNotifications();

    expect(mockApiFetch).toHaveBeenCalledTimes(3);
    expect(mockApiFetch).toHaveBeenNthCalledWith(3, "/api/notifications", {
      query: { page: 3 },
    });
    expect(notifications.value.map((notification) => notification.id)).toEqual([
      "n-1",
      "n-2",
      "n-3",
    ]);
  });

  it("fetchAllNotifications stops after the first page when hasMore is false", async () => {
    mockApiFetch.mockResolvedValue({
      notifications: [makeSample("n-1")],
      page: 1,
      hasMore: false,
    });

    const { notifications, fetchAllNotifications } = useNotifications();
    await fetchAllNotifications();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(notifications.value).toHaveLength(1);
  });

  it("fetchAllNotifications sets error and leaves the list empty when a page request fails", async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        notifications: [makeSample("n-1")],
        page: 1,
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error("Network error"));

    const { notifications, error, fetchAllNotifications } = useNotifications();
    await fetchAllNotifications();

    expect(error.value).toBeTruthy();
    expect(notifications.value).toEqual([]);
  });

  it("fetchAllNotifications fails loud instead of looping forever when hasMore never clears", async () => {
    mockApiFetch.mockResolvedValue({
      notifications: [makeSample("n-1")],
      page: 1,
      hasMore: true,
    });

    const { error, fetchAllNotifications } = useNotifications();
    await fetchAllNotifications();

    expect(error.value).toContain("exceeded");
  });

  it("fetchNotifications surfaces an error when the response envelope is malformed", async () => {
    mockApiFetch.mockResolvedValue([makeSample("n-1")]);

    const { error, fetchNotifications } = useNotifications();
    await fetchNotifications();

    expect(error.value).toContain("Malformed");
  });
});

function makeSample(id: string) {
  return {
    id,
    type: "like",
    tone: "accent",
    body: "Liked",
    isRead: false,
    createdAt: "2024-06-01T10:00:00Z",
  };
}
