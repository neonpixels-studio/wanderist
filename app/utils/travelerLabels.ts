/**
 * Shared display helpers for traveler identities (search results, discover
 * cards, and profile pages all render the same handle/name shapes).
 */

// Fallback shown when a traveler has neither a display name nor a handle.
export const DEFAULT_TRAVELER_NAME = "Wanderist traveler";

// Fallback byline for content (a guide, ...) whose author has set neither a
// handle nor a display name. Distinct from DEFAULT_TRAVELER_NAME — that's a
// standalone name shown in place of one; this is a full "by ..." phrase.
export const DEFAULT_AUTHOR_BYLINE = "by a traveler";

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

/**
 * "by @handle" / "by Display Name" / "by a traveler" byline used anywhere a
 * piece of content (a guide card, a guide's detail header, ...) attributes its
 * author. Handle wins over display name, matching formatHandle's precedence
 * elsewhere; falls back to a generic label rather than leaving the byline
 * blank when the author has set neither.
 */
export function formatAuthorByline(
  handle: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const formattedHandle = formatHandle(handle);
  if (formattedHandle) {
    return `by ${formattedHandle}`;
  }
  if (displayName) {
    return `by ${displayName}`;
  }
  return DEFAULT_AUTHOR_BYLINE;
}
