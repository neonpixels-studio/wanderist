/**
 * Security response headers (issue #253). Kept in a standalone, Nuxt-free
 * module so the values — and the production gating below — are unit
 * testable without booting Nuxt (see tests/security-headers.test.ts).
 *
 * Content-Security-Policy ships Report-Only, not enforcing: this app's
 * production Clerk Frontend API host is derived at runtime from an env var
 * (not committed here), and Nuxt's inline SSR hydration script needs
 * 'unsafe-inline' until the app adopts CSP nonces. There's also no
 * report-uri/report-to collector wired up yet, so violations only surface in
 * an individual visitor's devtools console — fine for manual pre-launch
 * checks, not for production-scale monitoring. A report collector is a
 * prerequisite follow-up before promoting this to an enforcing header.
 */

const CLERK_FRONTEND_API_ORIGIN = "https://*.clerk.accounts.dev";
const CLERK_TELEMETRY_ORIGIN = "https://clerk-telemetry.com";
// Covers both of Clerk's documented avatar CDN hosts (img.clerk.com and the
// cdn.clerk.com value this repo's own test fixtures use) rather than betting
// on one — cheap to broaden since this is an img-src entry on a Report-Only
// policy, not an enforcing one.
const CLERK_IMAGE_ORIGIN = "https://*.clerk.com";
const CLOUDFLARE_TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const MAPBOX_API_ORIGIN = "https://api.mapbox.com";
const MAPBOX_EVENTS_ORIGIN = "https://events.mapbox.com";
const MAPBOX_TILES_ORIGIN = "https://*.tiles.mapbox.com";
// Two shapes because the exact ingest subdomain is env-injected
// (NUXT_PUBLIC_SENTRY_DSN) and not committed to this repo.
const SENTRY_INGEST_ORIGINS = [
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
];
// app/assets/css/main.css @imports this stylesheet, which references files here.
const GOOGLE_FONTS_STYLESHEET_ORIGIN = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILE_ORIGIN = "https://fonts.gstatic.com";
// Google Analytics (gtag.js, loaded by app/plugins/google-analytics.client.ts):
// the tag script is served from googletagmanager.com, while collect beacons go
// to google-analytics.com and region-sharded (region1.*) / analytics.google.com
// hosts, hence the wildcards in connect-src and img-src (some beacons are img
// pixels, some are fetch/sendBeacon calls).
const GOOGLE_TAG_MANAGER_ORIGIN = "https://www.googletagmanager.com";
const GOOGLE_ANALYTICS_COLLECT_ORIGINS = [
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
];

const CONTENT_SECURITY_POLICY_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // 'unsafe-inline': Nuxt's SSR hydration payload is an inline <script> on
  // every response. Remove once CSP nonces are adopted (see file header).
  // blob:: Safari < 15.4 has no worker-src support and falls back to
  // script-src to gate the Web Worker mapbox-gl creates from a blob: URL.
  `script-src 'self' 'unsafe-inline' blob: ${CLERK_FRONTEND_API_ORIGIN} ${CLOUDFLARE_TURNSTILE_ORIGIN} ${GOOGLE_TAG_MANAGER_ORIGIN}`,
  `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_STYLESHEET_ORIGIN}`,
  `img-src 'self' data: blob: ${CLERK_IMAGE_ORIGIN} ${MAPBOX_API_ORIGIN} ${MAPBOX_TILES_ORIGIN} ${GOOGLE_ANALYTICS_COLLECT_ORIGINS.join(" ")}`,
  `font-src 'self' data: ${GOOGLE_FONTS_FILE_ORIGIN}`,
  // api.clerk.com (Clerk's Backend API) is deliberately omitted — it's only
  // ever called from server/, never the browser.
  `connect-src 'self' ${CLERK_FRONTEND_API_ORIGIN} ${CLERK_TELEMETRY_ORIGIN} ${MAPBOX_API_ORIGIN} ${MAPBOX_EVENTS_ORIGIN} ${MAPBOX_TILES_ORIGIN} ${SENTRY_INGEST_ORIGINS.join(" ")} ${GOOGLE_TAG_MANAGER_ORIGIN} ${GOOGLE_ANALYTICS_COLLECT_ORIGINS.join(" ")}`,
  "worker-src 'self' blob:",
  `frame-src 'self' ${CLOUDFLARE_TURNSTILE_ORIGIN}`,
  "manifest-src 'self'",
];

export const CONTENT_SECURITY_POLICY_REPORT_ONLY =
  CONTENT_SECURITY_POLICY_DIRECTIVES.join("; ");

// Permissions-Policy denies camera/microphone/geolocation: grepping
// app/composables/useMapbox.ts and app/pages/map.vue confirms this app never
// calls navigator.geolocation or mounts a GeolocateControl, so none of the
// three are used anywhere in the client today.
// max-age is 2 years with includeSubDomains but deliberately omits `preload`
// — preload list submission is effectively irreversible, a separate decision
// from shipping HSTS itself.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze(
  {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy-Report-Only": CONTENT_SECURITY_POLICY_REPORT_ONLY,
  },
);

/**
 * Nuxt route rules to apply SECURITY_HEADERS.
 *
 * Skipped when nodeEnv is "development" (`nuxt dev`, verified empirically —
 * Nuxt's CLI does not set NODE_ENV=production for that command). Everywhere
 * else `nuxt build` runs (production and, if ever enabled, the currently
 * -unused deploy-preview/branch-deploy contexts in netlify.toml) Nuxt's CLI
 * sets NODE_ENV=production regardless of which dotenvx env file is loaded,
 * so this applies there too — that's fine, since Netlify serves all of those
 * over HTTPS on its own domain. What this gate actually protects against is
 * the enforcing headers (X-Frame-Options: DENY, HSTS) misfiring in local
 * dev: XFO would block Nuxt's own same-origin devtools iframe (`devtools:
 * { enabled: true }` in nuxt.config.ts), and HSTS is host+port-agnostic, so
 * it would force every other local HTTPS dev server on the machine onto
 * HTTPS too.
 *
 * Takes nodeEnv as a parameter (rather than reading process.env internally)
 * so this stays a pure function tests can call directly with both branches,
 * instead of depending on the process environment vitest happens to run
 * under.
 */
export function buildSecurityRouteRules(
  nodeEnv: string | undefined,
): Record<string, { headers: Readonly<Record<string, string>> }> {
  if (nodeEnv === "development") {
    return {};
  }
  return { "/**": { headers: SECURITY_HEADERS } };
}
