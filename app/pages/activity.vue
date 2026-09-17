<template>
  <div ref="focusFallbackRef" class="content content--wide" tabindex="-1">
    <AppTopbar title="Activity" crumb="Updates" />

    <div v-if="isLoading && notifications.length === 0" class="activity__state">
      Loading activity…
    </div>

    <!-- Only the initial-load case (no notifications loaded at all) replaces
         the whole view with the error state. Once a list is showing, a later
         error (e.g. a failed dismiss) renders as a banner above it instead —
         otherwise one failed dismiss would wipe out an already-loaded list. -->
    <div
      v-else-if="error && notifications.length === 0"
      class="activity__state activity__state--error"
      role="alert"
    >
      {{ error }}
    </div>

    <template v-else>
      <div v-if="error" class="alert alert--error activity__error" role="alert">
        {{ error }}
      </div>

      <div v-if="notifications.length === 0" class="activity__state">
        No activity yet.
      </div>

      <div v-else class="activity__list">
        <ActivityNotificationItem
          v-for="notification in notifications"
          :key="notification.id"
          :ref="(instance) => setItemRef(notification.id, instance)"
          :notification="notification"
          :dismissing="dismissingIds.has(notification.id)"
          @dismiss="handleDismiss"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import ActivityNotificationItem from "~/components/ActivityNotificationItem.vue";
import { resolveAdjacentFocusIndex } from "~/utils/notificationFocus";

// The subset of an ActivityNotificationItem's exposed instance this page
// relies on to restore keyboard focus after a dismiss.
interface DismissFocusHandle {
  isDismissButtonFocused: () => boolean;
  focusDismissButton: () => void;
}

definePageMeta({ layout: "app", middleware: "auth" });
useHead({ title: "Wanderist — Activity" });

// /activity walks every page (fetchAllNotifications) so notifications older
// than the drawer's first-page preview are reachable here.
const {
  notifications,
  isLoading,
  error,
  dismissingIds,
  fetchAllNotifications,
  dismissNotification,
} = useNotifications();

// List-level fallback focus target when a dismiss empties the list. Placed
// on the page's outer content wrapper (rather than .activity__list) because
// that element is replaced by the empty state once the last row is removed.
const focusFallbackRef = ref<HTMLElement | null>(null);
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

onMounted(() => {
  fetchAllNotifications().catch((fetchError: unknown) => {
    console.error("[activity] fetchAllNotifications failed", fetchError);
  });
});

async function handleDismiss(id: string): Promise<void> {
  const dismissedItem = itemRefs.get(id);
  const wasFocused = dismissedItem?.isDismissButtonFocused() ?? false;
  const removedIndex = notifications.value.findIndex(
    (candidate) => candidate.id === id,
  );

  await dismissNotification(id);

  if (!wasFocused || removedIndex === -1) {
    return;
  }
  await nextTick();
  restoreFocusAfterDismiss(removedIndex);
}

// Moves focus to the dismiss button that slid into the removed row's slot
// (the "next" row), or the new last row if the removed row was last, so a
// keyboard user's focus never falls back to <body>. Falls back to the list
// container itself when the dismiss emptied the list entirely.
function restoreFocusAfterDismiss(removedIndex: number): void {
  const targetIndex = resolveAdjacentFocusIndex(
    notifications.value.length,
    removedIndex,
  );
  if (targetIndex === null) {
    focusFallbackRef.value?.focus();
    return;
  }
  const targetNotification = notifications.value[targetIndex];
  itemRefs.get(targetNotification.id)?.focusDismissButton();
}
</script>

<style scoped>
.activity__state {
  padding: 40px 0;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.activity__state--error {
  color: var(--error, #c0392b);
}

.activity__list {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.activity__error {
  margin-bottom: 14px;
}
</style>
