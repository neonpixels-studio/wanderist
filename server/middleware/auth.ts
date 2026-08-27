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
  return PUBLIC_READ_GUIDE_PATH.test(path) || PUBLIC_READ_TRIP_PATH.test(path);
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
