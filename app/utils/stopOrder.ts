// Pure array-of-ids helpers behind trip stop reordering (drag-and-drop and the
// keyboard move-up/move-down fallback). Kept free of Vue/DOM so the ordering
// logic itself is unit-testable without mounting the page or faking drag
// events; the component only wires these to refs and the persist call.

function swapAt(
  orderedIds: string[],
  indexA: number,
  indexB: number,
): string[] {
  const result = [...orderedIds];
  const temp = result[indexA]!;
  result[indexA] = result[indexB]!;
  result[indexB] = temp;
  return result;
}

// Returns the SAME array instance (not a copy) when the move is a no-op, so
// callers can use reference equality to detect "nothing changed" without a
// separate boundary check.
export function moveIdUp(orderedIds: string[], id: string): string[] {
  const index = orderedIds.indexOf(id);
  if (index <= 0) {
    return orderedIds;
  }
  return swapAt(orderedIds, index, index - 1);
}

export function moveIdDown(orderedIds: string[], id: string): string[] {
  const index = orderedIds.indexOf(id);
  if (index === -1 || index >= orderedIds.length - 1) {
    return orderedIds;
  }
  return swapAt(orderedIds, index, index + 1);
}

// Moves draggedId to sit immediately before targetId, used when a drag ends
// over another stop. Returns the same array instance when the drop is a no-op
// (dropped on itself, or either id is unknown).
export function moveIdBefore(
  orderedIds: string[],
  draggedId: string,
  targetId: string,
): string[] {
  const isNoOp =
    draggedId === targetId ||
    !orderedIds.includes(draggedId) ||
    !orderedIds.includes(targetId);
  if (isNoOp) {
    return orderedIds;
  }

  const withoutDragged = orderedIds.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  const result = [...withoutDragged];
  result.splice(targetIndex, 0, draggedId);
  return result;
}
