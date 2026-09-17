import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import {
  useDismissFocusRestore,
  type DismissFocusHandle,
} from "../useDismissFocusRestore";

interface Item {
  id: string;
}

// A real, focusable button backing the handle, so isDismissButtonFocused and
// focusDismissButton behave like the real component methods they stand in
// for (document.activeElement genuinely changes on .focus()).
function createFocusableHandle(): {
  handle: DismissFocusHandle;
  button: HTMLButtonElement;
} {
  const button = document.createElement("button");
  document.body.appendChild(button);
  return {
    button,
    handle: {
      isDismissButtonFocused: () => document.activeElement === button,
      focusDismissButton: () => button.focus(),
    },
  };
}

// Simulates a row whose dismiss button is disabled (e.g. its own dismiss is
// concurrently in flight): focus() is a real browser no-op on a disabled
// button, so this handle's focusDismissButton doesn't move activeElement.
function createDisabledHandle(): DismissFocusHandle {
  return {
    isDismissButtonFocused: () => false,
    focusDismissButton: () => {
      /* no-op, mirroring a disabled button */
    },
  };
}

describe("useDismissFocusRestore", () => {
  const elementsToClean: HTMLElement[] = [];

  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    elementsToClean.splice(0).forEach((element) => element.remove());
  });

  function trackElement<T extends HTMLElement>(element: T): T {
    elementsToClean.push(element);
    return element;
  }

  function mountFallback(): HTMLElement {
    const fallback = trackElement(document.createElement("div"));
    fallback.tabIndex = -1;
    document.body.appendChild(fallback);
    return fallback;
  }

  it("reports a row as focused only while its dismiss button holds document focus", () => {
    const { handle, button } = createFocusableHandle();
    trackElement(button);
    const { setItemRef, isRowFocused } = useDismissFocusRestore<Item>(
      () => [],
      ref(null),
    );
    setItemRef("a", handle);

    expect(isRowFocused("a")).toBe(false);
    button.focus();
    expect(isRowFocused("a")).toBe(true);
  });

  it("findRemovedIndex resolves a row's position in the current list", () => {
    const items: Item[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { findRemovedIndex } = useDismissFocusRestore<Item>(
      () => items,
      ref(null),
    );

    expect(findRemovedIndex("b")).toBe(1);
    expect(findRemovedIndex("missing")).toBe(-1);
  });

  it("moves focus to the row that slid into the removed slot", () => {
    const next = createFocusableHandle();
    trackElement(next.button);
    let items: Item[] = [{ id: "b" }];
    const { setItemRef, restoreFocusAfterDismiss } =
      useDismissFocusRestore<Item>(() => items, ref(mountFallback()));
    setItemRef("b", next.handle);

    restoreFocusAfterDismiss(0);

    expect(document.activeElement).toBe(next.button);
  });

  it("falls back to the fallback element when the dismiss emptied the list", () => {
    const fallback = mountFallback();
    const fallbackRef = ref(fallback);
    const { restoreFocusAfterDismiss } = useDismissFocusRestore<Item>(
      () => [],
      fallbackRef,
    );

    restoreFocusAfterDismiss(0);

    expect(document.activeElement).toBe(fallback);
  });

  it("falls back to the fallback element when the adjacent row's button can't take focus (e.g. disabled by its own in-flight dismiss)", () => {
    const items: Item[] = [{ id: "b" }];
    const fallback = mountFallback();
    const { setItemRef, restoreFocusAfterDismiss } =
      useDismissFocusRestore<Item>(() => items, ref(fallback));
    setItemRef("b", createDisabledHandle());

    restoreFocusAfterDismiss(0);

    expect(document.activeElement).toBe(fallback);
  });

  it("does not steal focus if it has already moved off <body> by the time restore runs", () => {
    const elsewhere = trackElement(document.createElement("button"));
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    const next = createFocusableHandle();
    trackElement(next.button);
    const items: Item[] = [{ id: "b" }];
    const { setItemRef, restoreFocusAfterDismiss } =
      useDismissFocusRestore<Item>(() => items, ref(mountFallback()));
    setItemRef("b", next.handle);

    restoreFocusAfterDismiss(0);

    expect(document.activeElement).toBe(elsewhere);
  });

  it("removes an item's ref when the row unmounts, so a stale instance is never reused", () => {
    const next = createFocusableHandle();
    trackElement(next.button);
    const items: Item[] = [{ id: "b" }];
    const fallback = mountFallback();
    const { setItemRef, restoreFocusAfterDismiss } =
      useDismissFocusRestore<Item>(() => items, ref(fallback));
    setItemRef("b", next.handle);
    setItemRef("b", null);

    restoreFocusAfterDismiss(0);

    expect(document.activeElement).toBe(fallback);
  });
});
