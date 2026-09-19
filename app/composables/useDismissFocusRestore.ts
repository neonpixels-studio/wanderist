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

function isDismissFocusHandle(value: unknown): value is DismissFocusHandle {
  const candidate = value as Partial<DismissFocusHandle> | null;
  return (
    typeof candidate?.isDismissButtonFocused === "function" &&
    typeof candidate?.focusDismissButton === "function"
  );
}

interface NeighborIds {
  dismissedId: string;
  nextId: string | undefined;
  previousId: string | undefined;
}

// Shared by AppNotifications.vue (the header drawer) and app/pages/activity.vue
// (the full list): after a dismiss removes a row, keyboard focus should land
// on the adjacent dismiss button rather than falling back to <body>.
// `getItems` returns the *current* rendered list (a closure over the
// caller's reactive slice, e.g. the drawer's preview-limited list). Restore
// targets are resolved by remembered neighbor id, not remembered position —
// the shared notification store can be refetched or reordered by an
// unrelated background load (e.g. /activity's page walk, or the drawer's
// periodic refresh) while a dismiss request is in flight, which would make a
// remembered index point at the wrong row by the time it resolves.
// `fallbackRef` is a list-level element to focus when there's no surviving
// neighbor (or its button can't take focus, e.g. it's disabled by its own
// in-flight dismiss).
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
    if (!isDismissFocusHandle(instance)) {
      console.error(
        `[useDismissFocusRestore] row "${id}" did not expose a valid dismiss-focus handle`,
      );
      return;
    }
    itemRefs.set(id, instance);
  }

  function isRowFocused(id: string): boolean {
    return itemRefs.get(id)?.isDismissButtonFocused() ?? false;
  }

  // <body> is the DOM's landing spot once a focused element is removed; the
  // fallback element is where a *previous* restore in the same burst may
  // have already parked focus. Either counts as "nothing meaningful has
  // focus", so a later restore is still free to improve on it. activeElement
  // is nullable per spec, which happy-dom/jsdom can surface between focus
  // changes.
  function isFocusStranded(): boolean {
    const activeElement = document.activeElement;
    return (
      !activeElement ||
      activeElement === document.body ||
      activeElement === fallbackRef.value
    );
  }

  // Captured before the dismiss request goes out, so the neighbor ids stay
  // correct even if the shared list changes shape while the request is in
  // flight.
  function captureNeighborIds(id: string): NeighborIds {
    const items = getItems();
    const index = items.findIndex((item) => item.id === id);
    return {
      dismissedId: id,
      nextId: index === -1 ? undefined : items[index + 1]?.id,
      previousId: index === -1 ? undefined : items[index - 1]?.id,
    };
  }

  // Prefers the dismissed row itself (a failed dismiss leaves it in place —
  // this returns focus to where the user was), then the row that was next,
  // then the row that was previous, then the list-level fallback. Only acts
  // while focus is still stranded: if the user moved focus elsewhere during
  // the request, or another dismiss's restore already ran, this is a no-op
  // rather than stealing focus back.
  function restoreFocus(neighbors: NeighborIds): void {
    if (!isFocusStranded()) {
      return;
    }

    const survivingIds = new Set(getItems().map((item) => item.id));
    const targetId = [
      neighbors.dismissedId,
      neighbors.nextId,
      neighbors.previousId,
    ].find((candidateId) => candidateId && survivingIds.has(candidateId));
    if (targetId) {
      itemRefs.get(targetId)?.focusDismissButton();
    }

    if (isFocusStranded()) {
      fallbackRef.value?.focus();
    }
  }

  // Single entry point so the capture-before/restore-after ordering (which
  // is load-bearing — capturing after the await would already see the
  // post-dismiss list) lives in one place rather than being repeated at
  // every call site.
  async function dismissWithFocusRestore(
    id: string,
    dismiss: () => Promise<void>,
  ): Promise<void> {
    const wasFocused = isRowFocused(id);
    const neighbors = captureNeighborIds(id);

    await dismiss();

    if (!wasFocused) {
      return;
    }
    await nextTick();
    restoreFocus(neighbors);
  }

  return { setItemRef, dismissWithFocusRestore };
}
