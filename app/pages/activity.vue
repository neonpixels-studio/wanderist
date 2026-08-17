<template>
  <div class="content content--wide">
    <AppTopbar title="Activity" crumb="Updates" />

    <div v-if="isLoading && notifications.length === 0" class="activity__state">
      Loading activity…
    </div>

    <div
      v-else-if="error"
      class="activity__state activity__state--error"
      role="alert"
    >
      {{ error }}
    </div>

    <template v-else>
      <div v-if="notifications.length === 0" class="activity__state">
        No activity yet.
      </div>

      <div v-else class="activity__list">
        <div
          v-for="notification in notifications"
          :key="notification.id"
          class="activity__item"
          :class="{ 'is-unread': !notification.isRead }"
        >
          <span
            class="activity__ico"
            :class="`activity__ico--${notification.tone ?? 'info'}`"
          >
            <AppIcon
              :name="resolveNotificationIcon(notification.type)"
              :size="16"
            />
          </span>
          <div class="activity__body">
            <p class="activity__text">
              {{ resolveNotificationText(notification) }}
            </p>
            <span class="activity__time">{{
              formatNotificationTime(notification.createdAt)
            }}</span>
          </div>
          <span v-if="!notification.isRead" class="activity__dot" />
        </div>
      </div>

      <AppLoadMoreButton
        :has-more="hasMore"
        :loading="isLoading"
        @load="handleLoadMore"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  resolveNotificationIcon,
  formatNotificationTime,
  resolveNotificationText,
} from "~/utils/notificationDisplay";

definePageMeta({ layout: "app", middleware: "auth" });
useHead({ title: "Wanderist — Activity" });

const {
  notifications,
  hasMore,
  isLoading,
  error,
  fetchNotifications,
  loadMore,
} = useNotifications();

onMounted(() => {
  fetchNotifications().catch((fetchError: unknown) => {
    console.error("[activity] fetchNotifications failed", fetchError);
  });
});

async function handleLoadMore(): Promise<void> {
  await loadMore();
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

.activity__item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  transition: background 0.12s;
}

.activity__item:last-child {
  border-bottom: none;
}

.activity__item.is-unread {
  background: var(--accent-weak);
}

.activity__ico {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  flex: none;
  background: var(--surface-2);
  color: var(--muted);
}

.activity__ico--accent {
  background: var(--accent-weak);
  color: var(--accent-ink);
}

.activity__ico--info {
  background: color-mix(in srgb, var(--info, #3b82f6) 12%, transparent);
  color: var(--info, #3b82f6);
}

.activity__ico--success {
  background: color-mix(in srgb, var(--success-ink, #16a34a) 12%, transparent);
  color: var(--success-ink, #16a34a);
}

.activity__ico--warning {
  background: color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent);
  color: var(--warning, #f59e0b);
}

.activity__body {
  flex: 1;
  min-width: 0;
}

.activity__text {
  font-size: 13.5px;
  line-height: 1.4;
  margin: 0;
}

.activity__time {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
  display: block;
}

.activity__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}
</style>
