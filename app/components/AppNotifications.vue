<template>
  <div
    v-if="open"
    class="notif is-open"
    role="dialog"
    aria-label="Notifications"
  >
    <div class="notif__head">
      <b>Notifications</b>
      <button class="notif__mark" @click="handleMarkAllRead">
        mark all read
      </button>
    </div>
    <div ref="listRef" class="notif__list" tabindex="-1">
      <div v-if="isLoading && notifications.length === 0" class="notif__empty">
        Loading…
      </div>
      <!-- Only the empty-list case replaces the row area with the error
           state, mirroring /activity: once rows are showing, a later error
           (e.g. a failed dismiss) renders as a banner instead of a message
           masquerading as an empty state on top of a populated list. -->
      <div
        v-else-if="error && notifications.length === 0"
        class="notif__empty notif__empty--error"
        role="alert"
      >
        {{ error }}
      </div>
      <div
        v-if="error && notifications.length > 0"
        class="alert alert--error notif__error"
        role="alert"
      >
        {{ error }}
      </div>
      <NotificationDrawerItem
        v-for="notification in previewNotifications"
        :key="notification.id"
        :ref="(instance) => setItemRef(notification.id, instance)"
        :notification="notification"
        :dismissing="dismissingIds.has(notification.id)"
        @activate="handleItemClick"
        @dismiss="handleDismiss"
      />
    </div>
    <NuxtLink class="notif__foot" to="/activity">
      View all activity
      <AppIcon name="arrow-right" :size="14" />
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
// Vue APIs are Nuxt auto-imports (accessed as globals so tests can substitute
// them via vi.stubGlobal). Components/composables are imported explicitly.
import NotificationDrawerItem from "~/components/NotificationDrawerItem.vue";
import { resolveAdjacentFocusIndex } from "~/utils/notificationFocus";
import type { AppNotification } from "~/composables/useNotifications";

// The subset of a NotificationDrawerItem's exposed instance this component
// relies on to restore keyboard focus after a dismiss.
interface DismissFocusHandle {
  isDismissButtonFocused: () => boolean;
  focusDismissButton: () => void;
}

const props = defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();

const {
  notifications,
  isLoading,
  error,
  dismissingIds,
  fetchNotifications,
  markAllRead,
  markRead,
  dismissNotification,
} = useNotifications();

// The drawer is a quick preview; the full list lives on /activity (linked in
// the footer). The shared store can hold every page once /activity has walked
// it, so cap what the dropdown renders.
const DRAWER_PREVIEW_LIMIT = 12;
const previewNotifications = computed(() =>
  notifications.value.slice(0, DRAWER_PREVIEW_LIMIT),
);

// List-level fallback focus target when a dismiss empties the preview list.
const listRef = ref<HTMLElement | null>(null);
// Not reactive on purpose — this only tracks live component instances for
// imperative focus calls, never rendered.
const itemRefs = new Map<string, DismissFocusHandle>();

function setItemRef(id: string, instance: unknown): void {
  if (!instance) {
    itemRefs.delete(id);
    return;
  }
  itemRefs.set(id, instance as DismissFocusHandle);
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      fetchNotifications().catch((fetchError: unknown) => {
        console.error(
          "[AppNotifications] fetchNotifications failed",
          fetchError,
        );
      });
    }
  },
);

async function handleMarkAllRead(): Promise<void> {
  await markAllRead();
}

async function handleItemClick(notification: AppNotification): Promise<void> {
  if (notification.isRead) {
    return;
  }
  await markRead(notification.id);
}

async function handleDismiss(notification: AppNotification): Promise<void> {
  const dismissedItem = itemRefs.get(notification.id);
  const wasFocused = dismissedItem?.isDismissButtonFocused() ?? false;
  const removedIndex = previewNotifications.value.findIndex(
    (candidate) => candidate.id === notification.id,
  );

  await dismissNotification(notification.id);

  if (!wasFocused || removedIndex === -1) {
    return;
  }
  await nextTick();
  restoreFocusAfterDismiss(removedIndex);
}

// Moves focus to the dismiss button that slid into the removed row's slot
// (the "next" row), or the new last row if the removed row was last, so a
// keyboard user's focus never falls back to <body>. Falls back to the list
// container itself when the dismiss emptied the preview entirely, or when
// the target button couldn't take focus (e.g. it's disabled because that
// row's own dismiss is concurrently in flight).
function restoreFocusAfterDismiss(removedIndex: number): void {
  const targetIndex = resolveAdjacentFocusIndex(
    previewNotifications.value.length,
    removedIndex,
  );
  if (targetIndex !== null) {
    const targetNotification = previewNotifications.value[targetIndex];
    itemRefs.get(targetNotification.id)?.focusDismissButton();
  }
  if (document.activeElement === document.body) {
    listRef.value?.focus();
  }
}
</script>
