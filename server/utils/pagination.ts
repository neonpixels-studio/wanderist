// Bounds how deep an offset scan can go — a legitimate walk never approaches
// this; it only stops a malicious/garbage page number (including non-safe
// integers like `1e300`, which `Number.isInteger` admits but would otherwise
// reach the query as a huge offset).
export const MAX_PAGE = 1000;

/**
 * Coerces an untrusted `page` query param to a safe 1-based page number,
 * falling back to page 1 for anything missing, non-integer, or out of range.
 */
export function parsePageParam(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE) {
    return 1;
  }
  return parsed;
}

/** Converts a 1-based page number into a zero-based row offset. */
export function pageToOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
