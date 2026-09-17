import { describe, it, expect } from "vitest";
import { resolveAdjacentFocusIndex } from "../notificationFocus";

describe("resolveAdjacentFocusIndex", () => {
  it("returns the removed index itself when a later item slid into its slot (the 'next' row)", () => {
    // Removing index 1 from a 3-item list leaves 2 items; index 1 now holds
    // what used to be the third item.
    expect(resolveAdjacentFocusIndex(2, 1)).toBe(1);
  });

  it("returns the removed index when the first item of several is removed", () => {
    expect(resolveAdjacentFocusIndex(2, 0)).toBe(0);
  });

  it("falls back to the new last index when the removed row was last (the 'previous' row)", () => {
    // A 3-item list with the last item (index 2) removed leaves 2 items;
    // there is no index 2 anymore, so the new last item (index 1) is used.
    expect(resolveAdjacentFocusIndex(2, 2)).toBe(1);
  });

  it("returns null when the removal emptied the list", () => {
    expect(resolveAdjacentFocusIndex(0, 0)).toBeNull();
  });
});
