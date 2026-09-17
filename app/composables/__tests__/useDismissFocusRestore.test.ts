import { describe, it, expect, afterEach, vi } from "vitest";
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
    vi.restoreAllMocks();
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

  it("does nothing when the dismissed row didn't have focus", async () => {
    const other = createFocusableHandle();
    trackElement(other.button);
    const fallback = mountFallback();
    let items: Item[] = [{ id: "a" }, { id: "b" }];
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(fallback));
    setItemRef("b", other.handle);
    const dismiss = vi.fn(async () => {
      items = items.filter((item) => item.id !== "a");
    });

    await dismissWithFocusRestore("a", dismiss);

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(other.button);
    expect(document.activeElement).not.toBe(fallback);
  });

  it("moves focus to the row that was next when a focused row is removed", async () => {
    const focused = createFocusableHandle();
    const next = createFocusableHandle();
    trackElement(focused.button);
    trackElement(next.button);
    let items: Item[] = [{ id: "a" }, { id: "b" }];
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(mountFallback()));
    setItemRef("a", focused.handle);
    setItemRef("b", next.handle);
    focused.button.focus();

    await dismissWithFocusRestore("a", async () => {
      items = items.filter((item) => item.id !== "a");
      // A real dismiss unmounts the row, which blurs its focused button to
      // <body> — mirror that so the guard in restoreFocus sees focus as
      // stranded, the same way it would after the real DOM update.
      focused.button.remove();
    });

    expect(document.activeElement).toBe(next.button);
  });

  it("moves focus to the row that was previous when the focused last row is removed", async () => {
    const previous = createFocusableHandle();
    const focused = createFocusableHandle();
    trackElement(previous.button);
    trackElement(focused.button);
    let items: Item[] = [{ id: "a" }, { id: "b" }];
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(mountFallback()));
    setItemRef("a", previous.handle);
    setItemRef("b", focused.handle);
    focused.button.focus();

    await dismissWithFocusRestore("b", async () => {
      items = items.filter((item) => item.id !== "b");
      focused.button.remove();
    });

    expect(document.activeElement).toBe(previous.button);
  });

  it("falls back to the fallback element when the dismiss emptied the list", async () => {
    const focused = createFocusableHandle();
    trackElement(focused.button);
    let items: Item[] = [{ id: "a" }];
    const fallback = mountFallback();
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(fallback));
    setItemRef("a", focused.handle);
    focused.button.focus();

    await dismissWithFocusRestore("a", async () => {
      items = [];
      focused.button.remove();
    });

    expect(document.activeElement).toBe(fallback);
  });

  it("falls back when the adjacent row's button can't take focus (e.g. disabled by its own in-flight dismiss)", async () => {
    const focused = createFocusableHandle();
    trackElement(focused.button);
    let items: Item[] = [{ id: "a" }, { id: "b" }];
    const fallback = mountFallback();
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(fallback));
    setItemRef("a", focused.handle);
    setItemRef("b", createDisabledHandle());
    focused.button.focus();

    await dismissWithFocusRestore("a", async () => {
      items = items.filter((item) => item.id !== "a");
      focused.button.remove();
    });

    expect(document.activeElement).toBe(fallback);
  });

  it("returns focus to the same row when the dismiss fails and the row stays", async () => {
    const focused = createFocusableHandle();
    trackElement(focused.button);
    const items: Item[] = [{ id: "a" }];
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(mountFallback()));
    setItemRef("a", focused.handle);
    focused.button.focus();

    await dismissWithFocusRestore("a", async () => {
      // Simulates a real browser blurring the button once it's disabled for
      // the in-flight request, then the request failing with the row left
      // in place (the real composable swallows the error into `error.value`
      // rather than removing the row).
      focused.button.blur();
    });

    expect(document.activeElement).toBe(focused.button);
  });

  it("resolves neighbors by identity, not position, so a list mutated during the request still lands correctly", async () => {
    // Simulates a background refetch reshaping the list while the dismiss
    // request is in flight: "a" (focused, index 0) is dismissed, but by the
    // time the request resolves an unrelated notification has been
    // prepended, shifting "b" from index 1 to index 2. A position-based
    // restore would target whatever now sits at index 1; identity-based
    // restore still finds "b".
    const focused = createFocusableHandle();
    const surviving = createFocusableHandle();
    trackElement(focused.button);
    trackElement(surviving.button);
    let items: Item[] = [{ id: "a" }, { id: "b" }];
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(mountFallback()));
    setItemRef("a", focused.handle);
    setItemRef("b", surviving.handle);
    focused.button.focus();

    await dismissWithFocusRestore("a", async () => {
      items = [{ id: "prepended" }, { id: "b" }];
      focused.button.remove();
    });

    expect(document.activeElement).toBe(surviving.button);
  });

  it("does not steal focus if it has already moved elsewhere by the time restore runs", async () => {
    const elsewhere = trackElement(document.createElement("button"));
    document.body.appendChild(elsewhere);
    const focused = createFocusableHandle();
    const next = createFocusableHandle();
    trackElement(focused.button);
    trackElement(next.button);
    let items: Item[] = [{ id: "a" }, { id: "b" }];
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(mountFallback()));
    setItemRef("a", focused.handle);
    setItemRef("b", next.handle);
    focused.button.focus();

    await dismissWithFocusRestore("a", async () => {
      items = items.filter((item) => item.id !== "a");
      elsewhere.focus();
    });

    expect(document.activeElement).toBe(elsewhere);
  });

  it("ignores a row instance that doesn't expose a valid dismiss-focus handle, without throwing", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let items: Item[] = [{ id: "a" }];
    const fallback = mountFallback();
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(fallback));
    setItemRef("a", { someOtherMethod: () => {} });

    await expect(
      dismissWithFocusRestore("a", async () => {
        items = [];
      }),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("removes an item's ref when the row unmounts, so a stale instance is never reused", async () => {
    const focused = createFocusableHandle();
    const next = createFocusableHandle();
    trackElement(focused.button);
    trackElement(next.button);
    let items: Item[] = [{ id: "a" }, { id: "b" }];
    const fallback = mountFallback();
    const { setItemRef, dismissWithFocusRestore } =
      useDismissFocusRestore<Item>(() => items, ref(fallback));
    setItemRef("a", focused.handle);
    setItemRef("b", next.handle);
    setItemRef("b", null);
    focused.button.focus();

    await dismissWithFocusRestore("a", async () => {
      items = items.filter((item) => item.id !== "a");
      focused.button.remove();
    });

    expect(document.activeElement).toBe(fallback);
  });
});
