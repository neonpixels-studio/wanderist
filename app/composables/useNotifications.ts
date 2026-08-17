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

const FIRST_PAGE = 1;

export function useNotifications() {
  const { apiFetch } = useApiClient();

  const notifications = useState<AppNotification[]>(
    NOTIFICATIONS_STATE_KEY,
    () => [],
  );
  const page = useState<number>(NOTIFICATIONS_PAGE_KEY, () => FIRST_PAGE);
  const hasMore = useState<boolean>(NOTIFICATIONS_HAS_MORE_KEY, () => false);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

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
    const response = await fetchPage(page.value + 1);
    if (!response) {
      return;
    }
    notifications.value = [
      ...notifications.value,
      ...(response.notifications ?? []),
    ];
    page.value = response.page ?? page.value + 1;
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
