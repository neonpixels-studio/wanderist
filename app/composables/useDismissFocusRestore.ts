import { resolveAdjacentFocusIndex } from "~/utils/notificationFocus";

interface DismissableItem {
  id: string;
}

// The subset of a row component's exposed instance this composable relies
// on to check and restore keyboard focus around a dismiss. Both
// NotificationDrawerItem and ActivityNotificationItem expose exactly this.
export interface DismissFocusHandle {
  isDismissButtonFocused: () => boolean;
  focusDismissButton: () => void;
}

// Shared by AppNotifications.vue (the header drawer) and app/pages/activity.vue
// (the full list): after a dismiss removes a row, keyboard focus should land
// on the adjacent dismiss button rather than falling back to <body>.
// `getItems` returns the *current* rendered list (a closure over the
// caller's reactive slice, e.g. the drawer's preview-limited list) so a row
// dismissed at the edge of that slice resolves against whatever shifted
// into view. `fallbackRef` is a list-level element to focus when there's no
// adjacent row left (or the adjacent row's button can't take focus, e.g.
// it's disabled by its own in-flight dismiss).
export function useDismissFocusRestore<Item extends DismissableItem>(
  getItems: () => Item[],
  fallbackRef: Ref<HTMLElement | null>,
) {
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

  function isRowFocused(id: string): boolean {
    return itemRefs.get(id)?.isDismissButtonFocused() ?? false;
  }

  function findRemovedIndex(id: string): number {
    return getItems().findIndex((item) => item.id === id);
  }

  // Called after the dismissed row has actually left the list (post-await,
  // post-nextTick). Only acts while focus is still stranded on <body> —
  // if the user moved focus elsewhere during the request, this doesn't
  // steal it back; if a concurrent dismiss's own restore already ran, this
  // is a no-op rather than double-moving focus.
  function restoreFocusAfterDismiss(removedIndex: number): void {
    if (document.activeElement !== document.body) {
      return;
    }

    const items = getItems();
    const targetIndex = resolveAdjacentFocusIndex(items.length, removedIndex);
    const targetItem = targetIndex === null ? undefined : items[targetIndex];
    if (targetItem) {
      itemRefs.get(targetItem.id)?.focusDismissButton();
    }

    if (document.activeElement === document.body) {
      fallbackRef.value?.focus();
    }
  }

  return {
    setItemRef,
    isRowFocused,
    findRemovedIndex,
    restoreFocusAfterDismiss,
  };
}
