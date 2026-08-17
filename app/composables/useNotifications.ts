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

const FIRST_PAGE = 1;

// Safety net against an infinite walk if the API ever reports `hasMore: true`
// forever (e.g. a server bug). At PAGE_SIZE 50 this caps a full walk at 10k
// notifications — far beyond any real inbox, so hitting it always signals a
// bug, not a genuine result set. Mirrors the trips store's MAX_TRIPS_PAGES.
const MAX_NOTIFICATION_PAGES = 200;

function isNotificationsResponse(
  value: unknown,
): value is NotificationsResponse {
  const candidate = value as Partial<NotificationsResponse> | null;
  return (
    !!candidate &&
    Array.isArray(candidate.notifications) &&
    typeof candidate.hasMore === "boolean"
  );
}

// Appends only notifications whose id hasn't been seen yet. Offset pagination
// over a top-inserted feed can re-serve a boundary row on the next page when a
// notification arrives mid-walk; deduping keeps `:key="id"` unique so the list
// renders (and unread-counts) correctly.
function appendUnseen(
  collected: AppNotification[],
  seenIds: Set<string>,
  rows: AppNotification[],
): void {
  for (const notification of rows) {
    if (seenIds.has(notification.id)) {
      continue;
    }
    seenIds.add(notification.id);
    collected.push(notification);
  }
}

// Monotonic across every useNotifications() instance (module scope), so a
// slower fetch that started earlier can't overwrite the shared list a newer
// fetch already committed — e.g. the drawer's page-1 request resolving after
// the /activity full walk it was fired alongside.
let latestFetchId = 0;

// `notifications` is one shared store (keyed by NOTIFICATIONS_STATE_KEY) so the
// header drawer and the /activity page agree on the list and its unread count.
// The server paginates GET /api/notifications to keep each query bounded; the
// drawer fetches only the first page (a fast preview) while /activity walks
// every page so older notifications stay reachable — the same
// paginate-server / assemble-client split the trips store uses.
export function useNotifications() {
  const { apiFetch } = useApiClient();

  const notifications = useState<AppNotification[]>(
    NOTIFICATIONS_STATE_KEY,
    () => [],
  );
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const unreadCount = computed(
    () =>
      notifications.value.filter((notification) => !notification.isRead).length,
  );

  async function fetchNotificationsPage(
    page: number,
  ): Promise<NotificationsResponse> {
    const response = await apiFetch<NotificationsResponse>(
      "/api/notifications",
      { query: { page } },
    );
    if (!isNotificationsResponse(response)) {
      throw new Error(
        "Malformed /api/notifications response: expected { notifications, hasMore }",
      );
    }
    return response;
  }

  async function fetchAllNotificationPages(): Promise<AppNotification[]> {
    const collected: AppNotification[] = [];
    const seenIds = new Set<string>();
    let page = FIRST_PAGE;
    let hasMore = true;

    while (hasMore) {
      if (page > MAX_NOTIFICATION_PAGES) {
        // Fail loud rather than silently returning a truncated list dressed
        // up as the full one — the caller surfaces this via `error`.
        throw new Error(
          `fetchAllNotifications exceeded ${MAX_NOTIFICATION_PAGES} pages — the API kept reporting hasMore: true`,
        );
      }
      const response = await fetchNotificationsPage(page);
      appendUnseen(collected, seenIds, response.notifications);
      hasMore = response.hasMore;
      page += 1;
    }

    return collected;
  }

  async function runFetch(
    load: () => Promise<AppNotification[]>,
  ): Promise<void> {
    const fetchId = ++latestFetchId;
    isLoading.value = true;
    error.value = null;
    try {
      const loaded = await load();
      // Only commit to the shared list if no newer fetch superseded this one.
      if (fetchId === latestFetchId) {
        notifications.value = loaded;
      }
    } catch (fetchError: unknown) {
      error.value = extractErrorMessage(fetchError);
    } finally {
      isLoading.value = false;
    }
  }

  // First page only — the drawer's fast preview. Older notifications live on
  // later pages and are reached via fetchAllNotifications on /activity.
  async function fetchNotifications(): Promise<void> {
    await runFetch(async () => {
      const response = await fetchNotificationsPage(FIRST_PAGE);
      return response.notifications;
    });
  }

  // Every page — the /activity view, so nothing older than page 1 is stranded.
  async function fetchAllNotifications(): Promise<void> {
    await runFetch(fetchAllNotificationPages);
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
    isLoading: readonly(isLoading),
    error: readonly(error),
    unreadCount,
    fetchNotifications,
    fetchAllNotifications,
    markAllRead,
    markRead,
  };
}
