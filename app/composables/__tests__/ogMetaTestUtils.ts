/**
 * Shared useOgMeta test scaffolding (#269). Stubs the Nuxt globals useOgMeta
 * reads — useSeoMeta, useRuntimeConfig, useRequestURL — with a trackable
 * useSeoMeta mock and a deterministic site origin/path, and exposes a helper
 * to pull the fields the composable last passed to useSeoMeta. Used by
 * useOgMeta's own spec and by the guide/profile/trip detail page specs that
 * call it; extracted here once that setup repeated a fourth time (rule of
 * three).
 */
import { expect, vi } from "vitest";

export const OG_META_TEST_SITE_ORIGIN = "https://wanderist.test";

export function stubOgMetaGlobals(
  requestUrl: string = `${OG_META_TEST_SITE_ORIGIN}/`,
): ReturnType<typeof vi.fn> {
  const useSeoMetaMock = vi.fn();
  vi.stubGlobal("useSeoMeta", useSeoMetaMock);
  // Overrides the blank-siteOrigin default in vitest.setup.ts (kept blank
  // there so unrelated billing-route tests can assert on a missing site
  // origin) and preserves mapboxToken so any other config-reading code in the
  // same test file keeps seeing its expected default.
  vi.stubGlobal("useRuntimeConfig", () => ({
    public: { mapboxToken: "", siteOrigin: OG_META_TEST_SITE_ORIGIN },
  }));
  vi.stubGlobal("useRequestURL", () => new URL(requestUrl));
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
