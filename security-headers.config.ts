/**
 * Security response headers applied to every route via nuxt.config.ts
 * routeRules. Extracted into a standalone, Nuxt-free module so the values can
 * be unit tested directly (see tests/security-headers.test.ts) without
 * booting Nuxt.
 *
 * Content-Security-Policy ships in REPORT-ONLY mode rather than enforcing.
 * See CONTENT_SECURITY_POLICY_DIRECTIVES below for why. Follow-up: once the
 * policy has been confirmed violation-free in production (browser devtools
 * console, or a report-uri collector), promote it to a real
 * `Content-Security-Policy` header.
 */

const CLERK_FRONTEND_API_ORIGIN = "https://*.clerk.accounts.dev";
const CLERK_API_ORIGIN = "https://api.clerk.com";
const CLERK_TELEMETRY_ORIGIN = "https://clerk-telemetry.com";
const CLERK_IMAGE_ORIGIN = "https://img.clerk.com";
const CLOUDFLARE_TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const MAPBOX_API_ORIGIN = "https://api.mapbox.com";
const MAPBOX_EVENTS_ORIGIN = "https://events.mapbox.com";
const MAPBOX_TILES_ORIGIN = "https://*.tiles.mapbox.com";
const SENTRY_INGEST_ORIGINS =
  "https://*.ingest.sentry.io https://*.ingest.us.sentry.io";

// Report-Only rather than enforcing. Two things make an enforcing policy risky
// to ship blind here:
// 1. Clerk's Frontend API host for this app's production instance is derived
//    at runtime from NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY (an env var, not
//    committed), so the exact origin the embedded <SignIn> component
//    (app/pages/login.vue) will load its JS SDK from can't be confirmed from
//    this repo alone. https://*.clerk.accounts.dev covers Clerk's shared dev
//    hosts; a custom production Clerk domain (if configured) would need to be
//    added once known.
// 2. Nuxt's SSR hydration payload is an inline `<script>` on every response,
//    so script-src needs 'unsafe-inline' unless/until the app adopts Nitro's
//    CSP nonce support — a separate, larger change, so it's flagged as a
//    follow-up rather than guessed at here.
//
// The rest of the directives are grounded in what this app's client actually
// talks to today:
// - Clerk user avatars (`user.imageUrl`, rendered directly in
//   app/components/AppSidebar.vue) come from Clerk's image CDN.
// - Stripe Checkout/Billing Portal never runs client-side JS or an iframe:
//   PlanCheckoutButton.vue does a full top-level redirect
//   (`window.location.href = /api/billing/checkout`) to a server route that
//   302s to Stripe's hosted page, so no stripe.com origin needs allowlisting.
// - Instagram media is fetched server-side and re-hosted through this app's
//   own /api/media/[id] route (server/utils/instagramClient.ts
//   fetchInstagramImage + server/api/connections/instagram/import.post.ts),
//   so the client never talks to instagram.com either.
// - Mapbox GL (app/composables/useMapbox.ts) loads styles/tiles and posts
//   telemetry directly from the browser.
// - Sentry's exact ingest subdomain is env-injected (NUXT_PUBLIC_SENTRY_DSN)
//   and not committed to this repo, so both current ingest host shapes are
//   allowlisted.
const CONTENT_SECURITY_POLICY_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline' ${CLERK_FRONTEND_API_ORIGIN} ${CLOUDFLARE_TURNSTILE_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${CLERK_IMAGE_ORIGIN} ${MAPBOX_API_ORIGIN}`,
  "font-src 'self' data:",
  `connect-src 'self' ${CLERK_FRONTEND_API_ORIGIN} ${CLERK_API_ORIGIN} ${CLERK_TELEMETRY_ORIGIN} ${MAPBOX_API_ORIGIN} ${MAPBOX_EVENTS_ORIGIN} ${MAPBOX_TILES_ORIGIN} ${SENTRY_INGEST_ORIGINS}`,
  "worker-src 'self' blob:",
  `frame-src ${CLOUDFLARE_TURNSTILE_ORIGIN}`,
  "manifest-src 'self'",
];

export const CONTENT_SECURITY_POLICY_REPORT_ONLY =
  CONTENT_SECURITY_POLICY_DIRECTIVES.join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy-Report-Only": CONTENT_SECURITY_POLICY_REPORT_ONLY,
};
