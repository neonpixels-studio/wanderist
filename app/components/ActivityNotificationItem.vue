<template>
  <div class="activity__item" :class="{ 'is-unread': !notification.isRead }">
    <span
      class="activity__ico"
      :class="`activity__ico--${notification.tone ?? 'info'}`"
    >
      <AppIcon :name="resolveNotificationIcon(notification.type)" :size="16" />
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
    <button
      type="button"
      class="activity__dismiss"
      aria-label="Dismiss notification"
      :disabled="dismissing"
      @click="$emit('dismiss', notification.id)"
    >
      <AppIcon name="x" :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import {
  resolveNotificationIcon,
  formatNotificationTime,
  resolveNotificationText,
} from "~/utils/notificationDisplay";
import type { AppNotification } from "~/composables/useNotifications";

defineProps<{
  notification: AppNotification;
  // Whether this specific notification's dismiss request is currently in
  // flight — disables the button so a double-click can't fire a second
  // DELETE for a row the first click already removed.
  dismissing: boolean;
}>();
defineEmits<{ dismiss: [id: string] }>();
</script>

<style scoped>
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

.activity__dismiss {
  width: 26px;
  height: 26px;
  flex: none;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  transition:
    background 0.12s,
    color 0.12s;
}

.activity__dismiss:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.activity__dismiss:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
