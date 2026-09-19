import tailwindcss from "@tailwindcss/vite";
import { buildSecurityRouteRules } from "./security-headers.config";

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  future: { compatibilityVersion: 4 },
  modules: ["@clerk/nuxt", "@sentry/nuxt/module", "@pinia/nuxt"],
  sourcemap: { client: "hidden" },
  // See security-headers.config.ts for the full rationale (issue #253).
  routeRules: buildSecurityRouteRules(process.env.NODE_ENV),
  sentry: {
    sourceMapsUploadOptions: {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    },
  },
  clerk: {
    skipServerMiddleware: true,
  },
  runtimeConfig: {
    databaseUrl: process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || "",
    // Set to "true" to block new-user provisioning (invite-only). Read via
    // runtimeConfig so the value bakes into the server bundle at build time and
    // survives into the deployed Netlify function.
    disableSignups: process.env.NUXT_DISABLE_SIGNUPS || "",
    // Server-only secrets, baked into the server bundle at build time so the
    // deployed Netlify function reads them from runtimeConfig rather than from
    // its own runtime environment. This is what lets dotenvx (which only runs at
    // build) be the single source: the values are injected into process.env
    // during `nuxt build`, captured here, and served at runtime via
    // useRuntimeConfig(). Server code reads `process.env.X || config.x` so a raw
    // runtime env var still wins if one is ever set, and tests keep setting
    // process.env directly.
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    stripePriceWandererMonthly: process.env.STRIPE_PRICE_WANDERER_MONTHLY || "",
    stripePriceWandererYearly: process.env.STRIPE_PRICE_WANDERER_YEARLY || "",
    stripePriceNomadMonthly: process.env.STRIPE_PRICE_NOMAD_MONTHLY || "",
    stripePriceNomadYearly: process.env.STRIPE_PRICE_NOMAD_YEARLY || "",
    clerkSecretKey: process.env.NUXT_CLERK_SECRET_KEY || "",
    clerkWebhookSecret: process.env.NUXT_CLERK_WEBHOOK_SECRET || "",
    instagramClientId: process.env.INSTAGRAM_CLIENT_ID || "",
    instagramClientSecret: process.env.INSTAGRAM_CLIENT_SECRET || "",
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
    public: {
      sentryDsn: "",
      siteOrigin: "",
      mapboxToken: "",
      // GA4 measurement ID, injected via NUXT_PUBLIC_GOOGLE_ANALYTICS_ID (set
      // only in .env.production). Blank everywhere else, and the client plugin
      // no-ops when blank, so analytics loads in production builds alone.
      googleAnalyticsId: "",
    },
  },
  css: ["~/assets/css/main.css", "mapbox-gl/dist/mapbox-gl.css"],
  devtools: { enabled: true },
  nitro: {
    preset: "netlify",
    // sentry.server.config.ts runs before useRuntimeConfig() is available, so
    // Sentry docs require the server DSN to come from process.env. dotenvx only
    // populates process.env at build, not in the deployed Netlify function, so
    // inline the (public, non-secret) DSN as a literal at build time. This lets
    // dotenvx remain the single source and keeps NUXT_PUBLIC_SENTRY_DSN out of
    // Netlify's runtime env. The client reads the baked runtimeConfig.public
    // value instead, so it needs no replacement.
    replace: {
      "process.env.NUXT_PUBLIC_SENTRY_DSN": JSON.stringify(
        process.env.NUXT_PUBLIC_SENTRY_DSN || "",
      ),
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
