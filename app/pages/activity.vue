<template>
  <div class="content content--wide">
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

onMounted(() => {
  fetchAllNotifications().catch((fetchError: unknown) => {
    console.error("[activity] fetchAllNotifications failed", fetchError);
  });
});

async function handleDismiss(id: string): Promise<void> {
  await dismissNotification(id);
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
