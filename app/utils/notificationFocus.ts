// After a dismiss removes a row from the list, the item that occupied
// `removedIndex` is gone and everything after it has shifted up by one.
// Given the list's length *after* removal, this resolves which index to
// focus next: the item that slid into the removed slot ("next"), or — when
// the removed row was last — the new final item ("previous"). Returns null
// when the list is now empty, so the caller falls back to a list-level focus
// target instead.
export function resolveAdjacentFocusIndex(
  remainingCount: number,
  removedIndex: number,
): number | null {
  if (remainingCount === 0) {
    return null;
  }
  return removedIndex < remainingCount ? removedIndex : remainingCount - 1;
}
