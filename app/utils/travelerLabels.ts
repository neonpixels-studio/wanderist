/**
 * Shared display helpers for traveler identities (search results, discover
 * cards, and profile pages all render the same handle/name shapes).
 */

// Fallback shown when a traveler has neither a display name nor a handle.
export const DEFAULT_TRAVELER_NAME = "Wanderist traveler";

/**
 * Normalises a handle for display, ensuring exactly one leading "@" and never
 * doubling it up. Returns an empty string for a null/empty handle so callers
 * can guard on falsiness.
 */
export function formatHandle(handle: string | null | undefined): string {
  if (!handle) {
    return "";
  }
  return `@${handle.replace(/^@+/, "")}`;
}
