import { describe, it, expect } from "vitest";
import { moveIdUp, moveIdDown, moveIdToDropTarget } from "../stopOrder";

describe("moveIdUp", () => {
  it("swaps the id with its predecessor", () => {
    expect(moveIdUp(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("is a no-op (same array instance) when already first", () => {
    const orderedIds = ["a", "b", "c"];
    expect(moveIdUp(orderedIds, "a")).toBe(orderedIds);
  });

  it("is a no-op (same array instance) for an unknown id", () => {
    const orderedIds = ["a", "b", "c"];
    expect(moveIdUp(orderedIds, "missing")).toBe(orderedIds);
  });

  it("does not mutate the input array", () => {
    const orderedIds = ["a", "b", "c"];
    moveIdUp(orderedIds, "b");
    expect(orderedIds).toEqual(["a", "b", "c"]);
  });
});

describe("moveIdDown", () => {
  it("swaps the id with its successor", () => {
    expect(moveIdDown(["a", "b", "c"], "b")).toEqual(["a", "c", "b"]);
  });

  it("is a no-op (same array instance) when already last", () => {
    const orderedIds = ["a", "b", "c"];
    expect(moveIdDown(orderedIds, "c")).toBe(orderedIds);
  });

  it("is a no-op (same array instance) for an unknown id", () => {
    const orderedIds = ["a", "b", "c"];
    expect(moveIdDown(orderedIds, "missing")).toBe(orderedIds);
  });

  it("does not mutate the input array", () => {
    const orderedIds = ["a", "b", "c"];
    moveIdDown(orderedIds, "b");
    expect(orderedIds).toEqual(["a", "b", "c"]);
  });
});

describe("moveIdToDropTarget", () => {
  it("moves the dragged id to just after the target id (dragging forward/down)", () => {
    expect(moveIdToDropTarget(["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("moves the dragged id to just before the target id (dragging backward/up)", () => {
    expect(moveIdToDropTarget(["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("moves the dragged id after the target when dropped on its immediate successor (dragging down)", () => {
    // Regression guard: inserting "before" the target here would reproduce
    // the original order, so a naive before-only implementation would treat
    // this drop as a no-op and fire a network request that changes nothing.
    expect(moveIdToDropTarget(["a", "b", "c"], "a", "b")).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("moves the dragged id before the target when dropped on its immediate predecessor (dragging up)", () => {
    expect(moveIdToDropTarget(["a", "b", "c"], "b", "a")).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("is a no-op (same array instance) when dropped on itself", () => {
    const orderedIds = ["a", "b", "c"];
    expect(moveIdToDropTarget(orderedIds, "b", "b")).toBe(orderedIds);
  });

  it("is a no-op (same array instance) when the dragged id is unknown", () => {
    const orderedIds = ["a", "b", "c"];
    expect(moveIdToDropTarget(orderedIds, "missing", "b")).toBe(orderedIds);
  });

  it("is a no-op (same array instance) when the target id is unknown", () => {
    const orderedIds = ["a", "b", "c"];
    expect(moveIdToDropTarget(orderedIds, "a", "missing")).toBe(orderedIds);
  });

  it("does not mutate the input array", () => {
    const orderedIds = ["a", "b", "c", "d"];
    moveIdToDropTarget(orderedIds, "a", "c");
    expect(orderedIds).toEqual(["a", "b", "c", "d"]);
  });
});
