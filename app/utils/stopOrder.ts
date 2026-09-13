// Pure array-of-ids helpers behind trip stop reordering (drag-and-drop and the
// keyboard move-up/move-down fallback). Kept free of Vue/DOM so the ordering
// logic itself is unit-testable without mounting the page or faking drag
// events; the component only wires these to refs and the persist call.

// Named here (rather than written as an inline function type in the .vue
// component) so its parameter isn't a bare TSFunctionType nested inside an
// SFC's <script setup> block — that combination trips the vue-eslint-parser +
// typescript-eslint parser pairing's scope analysis, which misreports the
// parameter as an unused variable.
export type StopOrderMutator = (stopIds: string[]) => string[];

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

// Moves draggedId to sit next to targetId, used when a drag ends over another
// stop. Direction-aware: dragging downward (toward a later index) drops AFTER
// the target, dragging upward drops BEFORE it — matching how a dragged card
// visually settles relative to the row it was released on. Since dragged and
// target are always distinct valid indices, the two always end up in a
// different relative order, so the only no-ops are: dropped on itself, or
// either id unknown.
export function moveIdToDropTarget(
  orderedIds: string[],
  draggedId: string,
  targetId: string,
): string[] {
  const draggedIndex = orderedIds.indexOf(draggedId);
  const targetIndex = orderedIds.indexOf(targetId);
  const isNoOp =
    draggedId === targetId || draggedIndex === -1 || targetIndex === -1;
  if (isNoOp) {
    return orderedIds;
  }

  const withoutDragged = orderedIds.filter((id) => id !== draggedId);
  const isDraggingDown = draggedIndex < targetIndex;
  const insertAt = withoutDragged.indexOf(targetId) + (isDraggingDown ? 1 : 0);
  const result = [...withoutDragged];
  result.splice(insertAt, 0, draggedId);
  return result;
}
