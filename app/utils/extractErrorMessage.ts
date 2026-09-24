export const UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred";

/**
 * Extracts the server's own deliberately-chosen error message, if any.
 *
 * Only messages the server deliberately chose to surface are trusted. Every
 * server error in this app is raised via H3's `createError({ statusMessage })`
 * (see server/utils/validation.ts, trip-queries.ts, etc.), and Nitro's error
 * handler (nitropack/dist/runtime/internal/error/prod.mjs) always puts that
 * intentional text in the JSON response body as `{ statusMessage }` — which
 * ofetch parses into `error.data.statusMessage` on the client. That nested
 * field is therefore a complete, sufficient source for every intentional
 * app error; it is the only field this function trusts.
 *
 * A top-level `error.statusMessage` is deliberately NOT trusted, even though
 * it looks similar: ofetch mirrors the raw HTTP reason phrase
 * (`response.statusText`) onto that same property name for every fetch
 * error that reached a response — including infra-level failures our own
 * server never touched (a Netlify/CDN 502 or 504, a proxy timeout). Trusting
 * it would let exactly that kind of raw, protocol-level text back in.
 *
 * A generic `.message` (a plain thrown `Error`, a `TypeError` from a failed
 * `fetch`, ofetch's own composed "[GET] ... 500 ..." string, etc.) is never
 * used either: it's diagnostic text for developers, not copy the server
 * chose to show a user, and it can contain raw network/implementation
 * detail. All of these cases return null instead.
 *
 * Returns null (rather than a generic fallback) so a caller that needs a
 * context-specific fallback — e.g. AppNewEntry.vue's publishFailureMessage
 * distinguishing edit vs create — can tell "the server said nothing" apart
 * from "the server's message happens to equal our generic fallback text".
 * Most callers don't need that distinction and should use
 * extractErrorMessage below instead.
 */
export function extractServerErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const errorObj = error as Record<string, unknown>;

  return readNestedStatusMessage(errorObj.data);
}

/**
 * Extracts a human-readable error message from an unknown thrown value,
 * falling back to a generic message when the server didn't deliberately
 * choose one (see extractServerErrorMessage for what is and isn't trusted).
 */
export function extractErrorMessage(error: unknown): string {
  return extractServerErrorMessage(error) ?? UNEXPECTED_ERROR_MESSAGE;
}

function readNestedStatusMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const dataObj = data as Record<string, unknown>;
  const statusMessage = dataObj.statusMessage;
  if (typeof statusMessage !== "string") {
    return null;
  }

  // A whitespace-only value is effectively empty — showing it would leave
  // the user staring at a blank error box.
  const trimmedStatusMessage = statusMessage.trim();
  return trimmedStatusMessage ? trimmedStatusMessage : null;
}
