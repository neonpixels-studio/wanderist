/**
 * Shared useOgMeta test scaffolding (#269). Stubs the Nuxt globals useOgMeta
 * reads for absolute-URL building — useSeoMeta, useRuntimeConfig,
 * useRequestURL — with a trackable useSeoMeta mock and a deterministic site
 * origin, and exposes a helper to pull the fields the composable last passed
 * to useSeoMeta.
 *
 * useRoute is deliberately NOT stubbed here: useOgMeta reads route.path for
 * og:url, but every caller (the composable's own spec, and the guide/profile/
 * trip detail page specs) already needs its own useRoute stub — the page
 * specs' stub carries the reactive route-param object their fetch wiring
 * depends on. Stubbing it here would silently clobber that.
 *
 * Used by useOgMeta's own spec and by the three public page specs that call
 * it; extracted here once that setup repeated a fourth time (rule of three).
 */
import { expect, vi } from "vitest";

export const OG_META_TEST_SITE_ORIGIN = "https://wanderist.test";

export function stubOgMetaGlobals(
  useSeoMetaMock: ReturnType<typeof vi.fn> = vi.fn(),
): ReturnType<typeof vi.fn> {
  vi.stubGlobal("useSeoMeta", useSeoMetaMock);
  // Overrides the blank-siteOrigin default in vitest.setup.ts (kept blank
  // there so unrelated billing-route tests can assert on a missing site
  // origin) and preserves mapboxToken so any other config-reading code in the
  // same test file keeps seeing its expected default.
  vi.stubGlobal("useRuntimeConfig", () => ({
    public: { mapboxToken: "", siteOrigin: OG_META_TEST_SITE_ORIGIN },
  }));
  // Only the origin matters here (the fallback for a blank siteOrigin); the
  // path comes from useRoute, stubbed separately by each caller.
  vi.stubGlobal("useRequestURL", () => new URL(`${OG_META_TEST_SITE_ORIGIN}/`));
  return useSeoMetaMock;
}

export function lastSeoMetaCall(
  useSeoMetaMock: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  const call = useSeoMetaMock.mock.calls.at(-1)?.[0] as
    Record<string, unknown> | undefined;
  expect(call).toBeDefined();
  return call as Record<string, unknown>;
}
