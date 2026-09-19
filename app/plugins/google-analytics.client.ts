/**
 * Client-only plugin that loads Google Analytics (gtag.js / GA4).
 *
 * Skipped in `nuxt dev` (which is what local development and the e2e suite run)
 * so real-time GA data isn't polluted by dev/test traffic, and skipped when the
 * measurement ID is blank so an environment can opt out entirely. GA4's
 * Enhanced Measurement (a property-side setting) handles SPA route changes, so
 * the single `config` call below is all the client needs.
 */

export default defineNuxtPlugin(() => {
  if (import.meta.dev) {
    return;
  }

  const measurementId = useRuntimeConfig().public.googleAnalyticsId as string;
  if (!measurementId) {
    return;
  }

  useHead({
    script: [
      {
        src: `https://www.googletagmanager.com/gtag/js?id=${measurementId}`,
        async: true,
      },
      {
        innerHTML: [
          "window.dataLayer = window.dataLayer || [];",
          "function gtag(){dataLayer.push(arguments);}",
          "gtag('js', new Date());",
          `gtag('config', '${measurementId}');`,
        ].join(""),
      },
    ],
  });
});
