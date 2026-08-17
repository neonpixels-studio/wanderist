import { useApiClient } from "~/composables/useApiClient";
import { extractErrorMessage } from "~/utils/extractErrorMessage";

export interface AppNotificationActor {
  id: string;
  displayName: string | null;
  handle: string | null;
}

export interface AppNotification {
  id: string;
  type: string;
  tone: string | null;
  body: string;
  isRead: boolean;
  createdAt: string;
  // The acting user (e.g. the follower), resolved server-side. Null for
  // legacy notifications with no actor recorded, or when the actor has since
  // deleted their account — the UI falls back to `body` in either case.
  actor: AppNotificationActor | null;
}

interface NotificationsResponse {
  notifications: AppNotification[];
  page: number;
  hasMore: boolean;
}

const NOTIFICATIONS_STATE_KEY = "notifications:list";
const NOTIFICATIONS_PAGE_KEY = "notifications:page";
const NOTIFICATIONS_HAS_MORE_KEY = "notifications:hasMore";
const NOTIFICATIONS_LOADING_KEY = "notifications:loading";
const NOTIFICATIONS_ERROR_KEY = "notifications:error";

const FIRST_PAGE = 1;

// The list, its pagination cursor, and its request status are one shared store
// keyed by NOTIFICATIONS_* so the header drawer and the /activity page never
// hold divergent copies (e.g. one paginated to page 3, the other reset to
// page 1). Keeping only some of these shared would let the two views clobber
// each other's state.
export function useNotifications() {
  const { apiFetch } = useApiClient();

  const notifications = useState<AppNotification[]>(
    NOTIFICATIONS_STATE_KEY,
    () => [],
  );
  const page = useState<number>(NOTIFICATIONS_PAGE_KEY, () => FIRST_PAGE);
  const hasMore = useState<boolean>(NOTIFICATIONS_HAS_MORE_KEY, () => false);
  const isLoading = useState<boolean>(NOTIFICATIONS_LOADING_KEY, () => false);
  const error = useState<string | null>(NOTIFICATIONS_ERROR_KEY, () => null);

  const unreadCount = computed(
    () =>
      notifications.value.filter((notification) => !notification.isRead).length,
  );

  async function fetchPage(
    nextPage: number,
  ): Promise<NotificationsResponse | null> {
    isLoading.value = true;
    error.value = null;
    try {
      return await apiFetch<NotificationsResponse>("/api/notifications", {
        query: { page: nextPage },
      });
    } catch (fetchError: unknown) {
      error.value = extractErrorMessage(fetchError);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchNotifications(): Promise<void> {
    const response = await fetchPage(FIRST_PAGE);
    if (!response) {
      return;
    }
    notifications.value = response.notifications ?? [];
    page.value = response.page ?? FIRST_PAGE;
    hasMore.value = response.hasMore ?? false;
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || isLoading.value) {
      return;
    }
    const requestedPage = page.value + 1;
    const response = await fetchPage(requestedPage);
    if (!response) {
      return;
    }
    // Bail if another consumer reset the list (e.g. the drawer re-fetched
    // page 1) while this request was in flight — appending page N onto a
    // now-shorter list would create a gap and strand the intervening pages.
    if (page.value !== requestedPage - 1) {
      return;
    }
    notifications.value = [
      ...notifications.value,
      ...(response.notifications ?? []),
    ];
    page.value = response.page ?? requestedPage;
    hasMore.value = response.hasMore ?? false;
  }

  async function markAllRead(): Promise<void> {
    error.value = null;
    try {
      await apiFetch("/api/notifications/read-all", { method: "POST" });
      notifications.value = notifications.value.map((notification) => ({
        ...notification,
        isRead: true,
      }));
    } catch (markError: unknown) {
      error.value = extractErrorMessage(markError);
    }
  }

  async function markRead(id: string): Promise<void> {
    error.value = null;
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
      notifications.value = notifications.value.map((notification) =>
        notification.id === id
          ? { ...notification, isRead: true }
          : notification,
      );
    } catch (markError: unknown) {
      error.value = extractErrorMessage(markError);
    }
  }

  return {
    notifications,
    hasMore: readonly(hasMore),
    isLoading: readonly(isLoading),
    error: readonly(error),
    unreadCount,
    fetchNotifications,
    loadMore,
    markAllRead,
    markRead,
  };
}
