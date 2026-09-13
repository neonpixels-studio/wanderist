<template>
  <div
    class="notif__item"
    :class="{ 'is-unread': !notification.isRead }"
    @click="$emit('activate', notification)"
  >
    <span
      class="notif__ico"
      :class="`notif__ico--${notification.tone ?? 'info'}`"
    >
      <AppIcon :name="resolveNotificationIcon(notification.type)" :size="16" />
    </span>
    <div
      class="notif__body"
      :tabindex="notification.isRead ? undefined : 0"
      :role="notification.isRead ? undefined : 'button'"
      @keydown.enter="$emit('activate', notification)"
      @keydown.space.prevent="$emit('activate', notification)"
    >
      <p class="notif__title">
        {{ resolveNotificationText(notification) }}
      </p>
      <span class="notif__time">{{
        formatNotificationTime(notification.createdAt)
      }}</span>
    </div>
    <span class="notif__dot" />
    <button
      type="button"
      class="notif__dismiss"
      :aria-label="`Dismiss notification: ${resolveNotificationText(notification)}`"
      :disabled="dismissing"
      @click.stop="$emit('dismiss', notification)"
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
// role/tabindex/keydown (above, on .notif__body) mark the row read on
// activation; the dismiss button (below) is .notif__body's sibling rather
// than nested inside it, because a real <button> nested inside another
// interactive role gets collapsed by assistive tech into a single
// unlabelled control.
defineEmits<{
  activate: [notification: AppNotification];
  dismiss: [notification: AppNotification];
}>();
</script>
