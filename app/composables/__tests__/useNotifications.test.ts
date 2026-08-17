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
    mockApiFetch.mockResolvedValue({ notifications: sampleNotifications });

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

    mockApiFetch.mockResolvedValue({ notifications: [] });
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

  it("fetchNotifications requests page 1 and records hasMore from the envelope", async () => {
    mockApiFetch.mockResolvedValue({
      notifications: [
        {
          id: "n-1",
          type: "like",
          tone: "accent",
          body: "Liked",
          isRead: false,
          createdAt: "2024-06-01T10:00:00Z",
        },
      ],
      page: 1,
      hasMore: true,
    });

    const { hasMore, fetchNotifications } = useNotifications();
    await fetchNotifications();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/notifications", {
      query: { page: 1 },
    });
    expect(hasMore.value).toBe(true);
  });

  it("loadMore fetches the next page and appends to the existing list", async () => {
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
        ],
        page: 1,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        notifications: [
          {
            id: "n-2",
            type: "comment",
            tone: "accent",
            body: "Comment",
            isRead: true,
            createdAt: "2024-06-01T09:00:00Z",
          },
        ],
        page: 2,
        hasMore: false,
      });

    const { notifications, hasMore, fetchNotifications, loadMore } =
      useNotifications();
    await fetchNotifications();
    await loadMore();

    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/api/notifications", {
      query: { page: 2 },
    });
    expect(notifications.value.map((notification) => notification.id)).toEqual([
      "n-1",
      "n-2",
    ]);
    expect(hasMore.value).toBe(false);
  });

  it("loadMore is a no-op when there is no next page", async () => {
    mockApiFetch.mockResolvedValue({
      notifications: [
        {
          id: "n-1",
          type: "like",
          tone: "accent",
          body: "Liked",
          isRead: false,
          createdAt: "2024-06-01T10:00:00Z",
        },
      ],
      page: 1,
      hasMore: false,
    });

    const { fetchNotifications, loadMore } = useNotifications();
    await fetchNotifications();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    await loadMore();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});
