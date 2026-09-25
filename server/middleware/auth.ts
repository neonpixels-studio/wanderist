import type { H3Event } from "h3";
import { requireClerkSecretKey, verifyClerkToken } from "../utils/clerk";

const API_PATH_PREFIX = "/api/";
const WEBHOOK_PATH_PREFIX = "/api/webhooks/";
const HTTP_GET = "GET";

// GET /api/guides/<id> serves a single guide, which may be public and shared
// with anonymous visitors. Matches exactly one path segment after /guides/ so
// it never covers the owner-only collection (/api/guides) or sub-resources like
// /api/guides/<id>/like. The route handler still enforces visibility.
const PUBLIC_READ_GUIDE_PATH = /^\/api\/guides\/[^/]+$/;

// GET /api/trips/<id> serves a single trip, which may be public and shared with
// anonymous visitors via its link. Matches exactly one path segment after
// /trips/ so it never covers the owner-only collection (/api/trips) or
// sub-resources like /api/trips/<id>/stops. The route handler still enforces
// visibility.
const PUBLIC_READ_TRIP_PATH = /^\/api\/trips\/[^/]+$/;

// GET /api/users/<id> serves a single profile, which may be public and shared
// with anonymous visitors via its link (#279). Matches exactly one path
// segment after /users/, so it never covers a multi-segment sub-resource
// (those are matched separately below) — but it does match any future
// single-segment GET under /api/users/ (e.g. a hypothetical .../me or
// .../export route), not just an id. That's fine for a handler that calls
// requireUser and 401s on its own, but a future single-segment route reaching
// for optionalUser would be silently made public by this pattern too — worth
// checking against this allowlist when adding one. The route handler
// (requireViewableProfile) still enforces visibility for the id case.
const PUBLIC_READ_PROFILE_PATH = /^\/api\/users\/[^/]+$/;

// GET /api/users/<id>/{followers,following,trips,guides} serves that same
// public profile's sub-resource lists (#279) — named explicitly (not
// [^/]+\/[^/]+) so a future owner-only sub-resource under /api/users/<id>/
// isn't opened by default. The route handler (requireViewableProfileTarget)
// still enforces visibility.
const PUBLIC_READ_PROFILE_SUB_PATH =
  /^\/api\/users\/[^/]+\/(followers|following|trips|guides)$/;

// Every GET path pattern a request may match without a bearer token. A list
// (not one growing `||` chain) so a fourth/fifth public route is a one-line
// addition to isOptionalAuthRoute below, not another branch to thread through
// its condition.
const OPTIONAL_AUTH_GET_PATTERNS = [
  PUBLIC_READ_GUIDE_PATH,
  PUBLIC_READ_TRIP_PATH,
  PUBLIC_READ_PROFILE_PATH,
  PUBLIC_READ_PROFILE_SUB_PATH,
];

function isApiPath(path: string): boolean {
  return path.startsWith(API_PATH_PREFIX);
}

function isWebhookPath(path: string): boolean {
  return path.startsWith(WEBHOOK_PATH_PREFIX);
}

// event.path can carry a query string and a trailing slash; strip both before
// matching route patterns so /api/guides/<id>, /api/guides/<id>/, and
// /api/guides/<id>?x=1 all resolve to the same canonical route.
function pathname(event: H3Event): string {
  const withoutQuery = event.path.split("?")[0];
  return withoutQuery.length > 1
    ? withoutQuery.replace(/\/+$/, "")
    : withoutQuery;
}

function isOptionalAuthRoute(event: H3Event): boolean {
  if (event.method !== HTTP_GET) {
    return false;
  }

  const path = pathname(event);
  return OPTIONAL_AUTH_GET_PATTERNS.some((pattern) => pattern.test(path));
}

function extractBearerToken(event: H3Event): string | null {
  const token = getHeader(event, "authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  return token ?? null;
}

async function verifyBearerToken(event: H3Event): Promise<string> {
  const token = extractBearerToken(event);
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  // Resolved outside the try below so a missing/misconfigured secret key
  // surfaces as a 500 (server misconfiguration), not a 401 (invalid token).
  const secretKey = requireClerkSecretKey();
  try {
    return await verifyClerkToken(token, secretKey);
  } catch (error) {
    console.error("verifyBearerToken: token verification failed", error);
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
}

// Optional auth for public read routes: a request with no Authorization header
// is genuinely anonymous and falls through (the route's visibility rule decides
// what it may see). A request that DOES send a token is a client that believes
// it has a session, so a bad/expired token is an error, not anonymity — verify
// strictly and let a failure 401 so the client refreshes or re-auths, rather
// than silently demoting the owner to a non-owner and 404-ing their own guide.
async function resolveOptionalUser(event: H3Event): Promise<void> {
  const token = extractBearerToken(event);
  if (!token) {
    return;
  }
  event.context.userId = await verifyBearerToken(event);
}

export default defineEventHandler(async (event) => {
  if (!isApiPath(event.path)) {
    return;
  }

  // Webhook routes authenticate via Svix signature, not a bearer token.
  if (isWebhookPath(event.path)) {
    return;
  }

  if (isOptionalAuthRoute(event)) {
    await resolveOptionalUser(event);
    return;
  }

  event.context.userId = await verifyBearerToken(event);
});
