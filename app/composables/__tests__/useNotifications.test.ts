import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vue from "vue";

const mockApiFetch = vi.fn();

// Back useState with a keyed cache (cleared per test) so two useNotifications()
// instances share state by key, the way Nuxt's real useState does — otherwise
// the "one shared list" contract would be untestable and pass on any code.
const stateStore = new Map<string, unknown>();
vi.stubGlobal("useState", <T>(key: string, init?: () => T) => {
  if (!stateStore.has(key)) {
    stateStore.set(key, vue.ref(init?.()));
  }
  return stateStore.get(key);
});

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
    stateStore.clear();
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

  it("dismissNotification calls DELETE /api/notifications/:id and removes only that notification", async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        notifications: [makeSample("n-1"), makeSample("n-2")],
        page: 1,
        hasMore: false,
      })
      .mockResolvedValueOnce({ success: true });

    const { notifications, fetchNotifications, dismissNotification } =
      useNotifications();
    await fetchNotifications();

    await dismissNotification("n-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/notifications/n-1", {
      method: "DELETE",
    });
    expect(notifications.value.map((notification) => notification.id)).toEqual([
      "n-2",
    ]);
  });

  it("dismissNotification sets error state and leaves the list intact when the API call fails", async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        notifications: [makeSample("n-1")],
        page: 1,
        hasMore: false,
      })
      .mockRejectedValueOnce(new Error("Server error"));

    const {
      notifications,
      error,
      dismissingIds,
      fetchNotifications,
      dismissNotification,
    } = useNotifications();
    await fetchNotifications();

    await expect(dismissNotification("n-1")).resolves.toBeUndefined();

    expect(error.value).toBeTruthy();
    expect(notifications.value.map((notification) => notification.id)).toEqual([
      "n-1",
    ]);
    // The `finally` cleanup must run even on failure, or the row's dismiss
    // button would stay disabled forever after one failed attempt with no
    // way to retry.
    expect(dismissingIds.value.has("n-1")).toBe(false);
  });

  it("dismissNotification guards against overlapping calls for the same id (e.g. a double-click)", async () => {
    mockApiFetch.mockResolvedValueOnce({
      notifications: [makeSample("n-1")],
      page: 1,
      hasMore: false,
    });
    const {
      notifications,
      fetchNotifications,
      dismissNotification,
      dismissingIds,
    } = useNotifications();
    await fetchNotifications();

    let resolveDelete: (value: unknown) => void = () => {};
    mockApiFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const firstCall = dismissNotification("n-1");
    expect(dismissingIds.value.has("n-1")).toBe(true);

    // Fires while the first DELETE is still in flight — must be a no-op, not
    // a second DELETE that would 404 against the row the first call already
    // removed.
    const secondCall = dismissNotification("n-1");

    resolveDelete({ success: true });
    await Promise.all([firstCall, secondCall]);

    // 1 call for fetchNotifications' page fetch + 1 for the single DELETE.
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(notifications.value).toEqual([]);
    expect(dismissingIds.value.has("n-1")).toBe(false);
  });

  it("a dismiss that completes before an in-flight fetch resolves is not undone by that fetch's stale response", async () => {
    let resolveGet: (value: unknown) => void = () => {};
    mockApiFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );

    const { notifications, fetchNotifications, dismissNotification } =
      useNotifications();

    // Start a fetch but don't let it resolve yet — mirrors the drawer opening
    // (fetchNotifications) or /activity mounting (fetchAllNotifications)
    // while the user is already looking at a previously-loaded list.
    const fetchCall = fetchNotifications();

    // The DELETE for n-1 resolves before that GET does.
    mockApiFetch.mockResolvedValueOnce({ success: true });
    await dismissNotification("n-1");

    // The in-flight GET now resolves with a response captured before the
    // delete — it still contains n-1. Applying it as-is would resurrect the
    // row the user just removed.
    resolveGet({
      notifications: [makeSample("n-1")],
      page: 1,
      hasMore: false,
    });
    await fetchCall;

    expect(notifications.value.map((notification) => notification.id)).toEqual(
      [],
    );
  });

  it("dismissNotification treats a 404 (already gone) as success, removing the row without setting error", async () => {
    mockApiFetch.mockResolvedValueOnce({
      notifications: [makeSample("n-1")],
      page: 1,
      hasMore: false,
    });
    const { notifications, error, fetchNotifications, dismissNotification } =
      useNotifications();
    await fetchNotifications();

    mockApiFetch.mockRejectedValueOnce({ statusCode: 404 });
    await dismissNotification("n-1");

    expect(notifications.value).toEqual([]);
    expect(error.value).toBeNull();
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

  it("fetchAllNotifications sets error and does not commit a partial list when a page fails mid-walk", async () => {
    // Seed a known list first, then fail on the second page of a fresh walk.
    mockApiFetch.mockResolvedValueOnce({
      notifications: [makeSample("seed")],
      page: 1,
      hasMore: false,
    });
    const { notifications, error, fetchNotifications, fetchAllNotifications } =
      useNotifications();
    await fetchNotifications();
    expect(notifications.value.map((item) => item.id)).toEqual(["seed"]);

    mockApiFetch
      .mockResolvedValueOnce({
        notifications: [makeSample("n-1")],
        page: 1,
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error("Network error"));
    await fetchAllNotifications();

    // The failed walk surfaces the error and leaves the previous list intact
    // rather than committing the single page it managed to fetch.
    expect(error.value).toBeTruthy();
    expect(notifications.value.map((item) => item.id)).toEqual(["seed"]);
  });

  it("fetchAllNotifications dedupes a row re-served across pages by a mid-walk insert", async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        notifications: [makeSample("n-1"), makeSample("n-2")],
        page: 1,
        hasMore: true,
      })
      // n-2 shifted onto page 2 because a newer notification arrived; it must
      // not appear twice.
      .mockResolvedValueOnce({
        notifications: [makeSample("n-2"), makeSample("n-3")],
        page: 2,
        hasMore: false,
      });

    const { notifications, fetchAllNotifications } = useNotifications();
    await fetchAllNotifications();

    expect(notifications.value.map((item) => item.id)).toEqual([
      "n-1",
      "n-2",
      "n-3",
    ]);
  });

  it("fetchNotifications merges the first page in without truncating a fuller loaded list", async () => {
    // /activity walks three rows into the shared list.
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
    const { notifications, fetchNotifications, fetchAllNotifications } =
      useNotifications();
    await fetchAllNotifications();
    expect(notifications.value).toHaveLength(3);

    // The drawer's page-1 refresh (a brand-new n-0 plus the existing n-1) must
    // not shrink the list back to the first page.
    mockApiFetch.mockResolvedValueOnce({
      notifications: [makeSample("n-0"), makeSample("n-1")],
      page: 1,
      hasMore: true,
    });
    await fetchNotifications();

    expect(notifications.value.map((item) => item.id)).toEqual([
      "n-0",
      "n-1",
      "n-2",
      "n-3",
    ]);
  });

  it("shares one list across instances (drawer + activity see the same store)", async () => {
    mockApiFetch.mockResolvedValue({
      notifications: [makeSample("shared-1")],
      page: 1,
      hasMore: false,
    });

    const activity = useNotifications();
    const drawer = useNotifications();
    await activity.fetchAllNotifications();

    expect(drawer.notifications.value.map((item) => item.id)).toEqual([
      "shared-1",
    ]);
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
