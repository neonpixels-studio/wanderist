import { getErrorStatus } from "~/utils/getErrorStatus";

const UNAUTHORIZED_STATUS = 401;

/**
 * True when a thrown fetch error's status is 401.
 *
 * server/middleware/auth.ts verifies a bearer token strictly even on the
 * optional-auth trip/guide read routes: a request with no token is genuine
 * anonymity (falls through to the route's visibility rule, a 404 if private),
 * but a request that DOES send a token that fails verification (expired/
 * revoked session) 401s rather than silently demoting the owner to a
 * non-owner. That's not retryable with the same stale token, so stores/trips
 * and stores/guides treat it like a 404 — "not found" with its sign-in
 * affordance — rather than a generic 5xx/network error a "try again" button
 * could plausibly fix.
 */
export function isUnauthorizedError(error: unknown): boolean {
  return getErrorStatus(error) === UNAUTHORIZED_STATUS;
}
