import { getErrorStatus } from "~/utils/getErrorStatus";

const NOT_FOUND_STATUS = 404;

/**
 * True when a thrown fetch error's status is 404.
 *
 * Shared by useProfile, stores/trips, and stores/guides so a 404 (gone/
 * private) reads as "not found" everywhere while a 5xx or network failure
 * surfaces as a distinct, retryable error.
 */
export function isNotFoundError(error: unknown): boolean {
  return getErrorStatus(error) === NOT_FOUND_STATUS;
}
