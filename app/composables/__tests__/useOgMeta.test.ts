import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useOgMeta } from "../useOgMeta";
import {
  OG_META_TEST_SITE_ORIGIN,
  lastSeoMetaCall,
  stubOgMetaGlobals,
} from "./ogMetaTestUtils";

const useSeoMetaMock = stubOgMetaGlobals(
  `${OG_META_TEST_SITE_ORIGIN}/guides/guide-1`,
);

describe("useOgMeta", () => {
  beforeEach(() => {
    useSeoMetaMock.mockClear();
  });

  it("builds title, description, and og/twitter fields from the given input", () => {
    useOgMeta(() => ({
      title: "Wanderist — Tokyo on foot",
      description: "Start in Yanaka at sunrise.",
    }));

    const meta = lastSeoMetaCall(useSeoMetaMock);
    const title = meta.title as () => string;
    const description = meta.description as () => string;

    expect(title()).toBe("Wanderist — Tokyo on foot");
    expect((meta.ogTitle as () => string)()).toBe(title());
    expect((meta.twitterTitle as () => string)()).toBe(title());
    expect(description()).toBe("Start in Yanaka at sunrise.");
    expect((meta.ogDescription as () => string)()).toBe(description());
    expect((meta.twitterDescription as () => string)()).toBe(description());
    expect(meta.ogType).toBe("website");
  });

  it("falls back to the site favicon, as an absolute URL, with the small summary card when no image path is given", () => {
    useOgMeta(() => ({ title: "t", description: "d" }));

    const meta = lastSeoMetaCall(useSeoMetaMock);
    const ogImage = meta.ogImage as () => string;
    // No real image to show, so the small "summary" card is used rather than
    // "summary_large_image", which renders broken/blank on most platforms
    // for a favicon-sized image.
    expect(ogImage()).toBe("https://wanderist.test/favicon.ico");
    expect((meta.twitterCard as () => string)()).toBe("summary");
  });

  it("builds an absolute image URL from a site-relative image path and uses the large-image card", () => {
    useOgMeta(() => ({
      title: "t",
      description: "d",
      imagePath: "/api/media/media-1",
    }));

    const meta = lastSeoMetaCall(useSeoMetaMock);
    const ogImage = meta.ogImage as () => string;
    const twitterImage = meta.twitterImage as () => string;

    expect(ogImage()).toBe("https://wanderist.test/api/media/media-1");
    expect(twitterImage()).toBe(ogImage());
    expect((meta.twitterCard as () => string)()).toBe("summary_large_image");
  });

  it("truncates an overly long description on a Unicode code-point boundary rather than emitting it verbatim", () => {
    // A surrogate-pair emoji straddling the truncation boundary: slicing by
    // UTF-16 code unit (rather than code point) would cut it in half and
    // leave a lone, unrenderable surrogate in the output.
    const longDescription = `${"x".repeat(198)}🌍${"y".repeat(300)}`;

    useOgMeta(() => ({ title: "t", description: longDescription }));

    const description = lastSeoMetaCall(useSeoMetaMock)
      .description as () => string;
    const result = description();
    expect(Array.from(result).length).toBe(200);
    expect(result.endsWith("…")).toBe(true);
    // The emoji (a surrogate pair) must survive intact, not be split.
    expect(result).toContain("🌍");
  });

  it("leaves a short description untouched", () => {
    useOgMeta(() => ({ title: "t", description: "short and sweet" }));

    const description = lastSeoMetaCall(useSeoMetaMock)
      .description as () => string;
    expect(description()).toBe("short and sweet");
  });

  it("builds an exact absolute og:url from the current request path", () => {
    useOgMeta(() => ({ title: "t", description: "d" }));

    const ogUrl = lastSeoMetaCall(useSeoMetaMock).ogUrl as () => string;
    expect(ogUrl()).toBe("https://wanderist.test/guides/guide-1");
  });

  it("re-evaluates the getter on each read rather than caching the first result", () => {
    let title = "First";
    useOgMeta(() => ({ title, description: "d" }));

    const titleGetter = lastSeoMetaCall(useSeoMetaMock).title as () => string;
    expect(titleGetter()).toBe("First");

    title = "Second";
    expect(titleGetter()).toBe("Second");
  });
});

describe("useOgMeta — origin fallback", () => {
  // Its own describe block (rather than a case inside the block above) so it
  // can stub a blank siteOrigin and a different request origin without
  // disturbing the shared https://wanderist.test stub the other cases share.
  const fallbackSeoMetaMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("useSeoMeta", fallbackSeoMetaMock);
    vi.stubGlobal("useRuntimeConfig", () => ({ public: {} }));
    vi.stubGlobal("useRequestURL", () => new URL("https://fallback.example/x"));
    fallbackSeoMetaMock.mockClear();
  });

  afterEach(() => {
    // Restore the shared stubs so nothing here leaks into the describe block
    // above if the file is re-run (e.g. watch mode) or reordered.
    stubOgMetaGlobals(`${OG_META_TEST_SITE_ORIGIN}/guides/guide-1`);
  });

  it("uses the request origin when runtimeConfig.public.siteOrigin is blank", () => {
    useOgMeta(() => ({ title: "t", description: "d" }));

    const ogImage = lastSeoMetaCall(fallbackSeoMetaMock)
      .ogImage as () => string;
    expect(ogImage()).toBe("https://fallback.example/favicon.ico");
  });
});
