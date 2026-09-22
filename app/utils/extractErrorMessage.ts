const UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred";

/**
 * Extracts a human-readable error message from an unknown thrown value.
 *
 * Only messages the server deliberately chose to surface are trusted; every
 * server error in this app is raised via H3's `createError({ statusMessage })`
 * (see server/utils/validation.ts, trip-queries.ts, etc.), so `statusMessage`
 * — nested under `data` (ofetch-wrapped Nitro errors) or directly on the
 * error (raw H3 errors) — is the one place an intentional, user-facing
 * message lives.
 *
 * A generic `.message` (a plain thrown `Error`, a `TypeError` from a failed
 * `fetch`, ofetch's own composed "[GET] ... 500 ..." string, etc.) is never
 * used: it's diagnostic text for developers, not copy the server chose to
 * show a user, and it can contain raw network/implementation detail. Those
 * cases fall through to the generic fallback instead.
 *
 * Priority:
 * 1. `error.data.statusMessage` — Nitro server errors wrapped by ofetch
 * 2. `error.statusMessage` — direct H3 error objects
 * 3. Generic fallback message
 */
export function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return UNEXPECTED_ERROR_MESSAGE;
  }

  const errorObj = error as Record<string, unknown>;

  const nestedStatusMessage = readNestedStatusMessage(errorObj.data);
  if (nestedStatusMessage) {
    return nestedStatusMessage;
  }

  return readStringField(errorObj, "statusMessage") || UNEXPECTED_ERROR_MESSAGE;
}

function readNestedStatusMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const dataObj = data as Record<string, unknown>;
  return readStringField(dataObj, "statusMessage");
}

function readStringField(
  record: Record<string, unknown>,
  field: string,
): string | null {
  const value = record[field];
  return typeof value === "string" ? value : null;
}
