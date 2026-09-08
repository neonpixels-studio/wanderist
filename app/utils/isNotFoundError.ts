const NOT_FOUND_STATUS = 404;

/**
 * True when a thrown fetch error's status is 404.
 *
 * ofetch's FetchError exposes statusCode, but this stays defensive about
 * wrappers that only preserve response.status or a nested data.statusCode —
 * otherwise a private/missing resource could render as a generic retryable
 * error instead of "not found". Shared by useProfile, stores/trips, and
 * stores/guides so a 404 (gone/private) reads as "not found" everywhere while
 * a 5xx, 401, or network failure surfaces as a distinct, retryable error — a
 * 401 on these routes means the caller's token failed verification (see
 * server/middleware/auth.ts), which a retry can genuinely fix since apiFetch
 * mints a fresh token on every call.
 */
export function isNotFoundError(error: unknown): boolean {
  const candidate = error as {
    statusCode?: number;
    response?: { status?: number };
    data?: { statusCode?: number };
  };
  const status =
    candidate?.statusCode ??
    candidate?.response?.status ??
    candidate?.data?.statusCode;
  return status === NOT_FOUND_STATUS;
}
