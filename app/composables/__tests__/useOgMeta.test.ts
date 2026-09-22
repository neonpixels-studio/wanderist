import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ref } from "vue";
import { useOgMeta } from "../useOgMeta";
import { lastSeoMetaCall, stubOgMetaGlobals } from "./ogMetaTestUtils";

const useSeoMetaMock = stubOgMetaGlobals();
vi.stubGlobal("useRoute", () => ({
  path: "/guides/guide-1",
  params: {},
  query: {},
}));

describe("useOgMeta", () => {
  beforeEach(() => {
    useSeoMetaMock.mockClear();
  });

  it("builds title, description, and og/twitter fields from the given input", () => {
    useOgMeta(() => ({
      pageTitle: "Tokyo on foot",
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
    useOgMeta(() => ({ pageTitle: "t", description: "d" }));

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
      pageTitle: "t",
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

  it("collapses whitespace (including newlines) before truncating", () => {
    useOgMeta(() => ({
      pageTitle: "t",
      description: "Start in Yanaka.\n\n  End at the river.  ",
    }));

    const description = lastSeoMetaCall(useSeoMetaMock)
      .description as () => string;
    expect(description()).toBe("Start in Yanaka. End at the river.");
  });

  it("truncates an overly long description on a Unicode code-point boundary rather than emitting it verbatim", () => {
    // A surrogate-pair emoji straddling the truncation boundary: slicing by
    // UTF-16 code unit (rather than code point) would cut it in half and
    // leave a lone, unrenderable surrogate in the output.
    const longDescription = `${"x".repeat(198)}🌍${"y".repeat(300)}`;

    useOgMeta(() => ({ pageTitle: "t", description: longDescription }));

    const description = lastSeoMetaCall(useSeoMetaMock)
      .description as () => string;
    const result = description();
    expect(Array.from(result).length).toBe(200);
    expect(result.endsWith("…")).toBe(true);
    // The emoji (a surrogate pair) must survive intact, not be split.
    expect(result).toContain("🌍");
  });

  it("leaves a description of exactly the max length untouched", () => {
    const exactLength = "x".repeat(200);

    useOgMeta(() => ({ pageTitle: "t", description: exactLength }));

    const description = lastSeoMetaCall(useSeoMetaMock)
      .description as () => string;
    expect(description()).toBe(exactLength);
  });

  it("truncates a description one character over the max length", () => {
    const overLength = "x".repeat(201);

    useOgMeta(() => ({ pageTitle: "t", description: overLength }));

    const description = lastSeoMetaCall(useSeoMetaMock)
      .description as () => string;
    expect(Array.from(description()).length).toBe(200);
    expect(description().endsWith("…")).toBe(true);
  });

  it("leaves a short description untouched", () => {
    useOgMeta(() => ({ pageTitle: "t", description: "short and sweet" }));

    const description = lastSeoMetaCall(useSeoMetaMock)
      .description as () => string;
    expect(description()).toBe("short and sweet");
  });

  it("builds an exact absolute og:url from the current route path", () => {
    useOgMeta(() => ({ pageTitle: "t", description: "d" }));

    const ogUrl = lastSeoMetaCall(useSeoMetaMock).ogUrl as () => string;
    expect(ogUrl()).toBe("https://wanderist.test/guides/guide-1");
  });

  it("picks up a reactive update to the underlying data (e.g. once a page's store value loads in)", () => {
    const pageTitle = ref("First");
    useOgMeta(() => ({ pageTitle: pageTitle.value, description: "d" }));

    const titleGetter = lastSeoMetaCall(useSeoMetaMock).title as () => string;
    expect(titleGetter()).toBe("Wanderist — First");

    pageTitle.value = "Second";
    expect(titleGetter()).toBe("Wanderist — Second");
  });
});

describe("useOgMeta — origin fallback", () => {
  // Its own describe block (rather than a case inside the block above) so it
  // can stub a blank siteOrigin and a different request origin without
  // disturbing the shared https://wanderist.test stub the other cases share.
  // Reuses the SAME useSeoMetaMock reference throughout (rather than
  // installing an unrelated vi.fn()) so restoring the shared stubs in
  // afterEach actually reconnects the block above's mock, instead of leaving
  // it registered to a mock nothing calls anymore.
  beforeEach(() => {
    stubOgMetaGlobals(useSeoMetaMock);
    vi.stubGlobal("useRuntimeConfig", () => ({ public: {} }));
    vi.stubGlobal("useRequestURL", () => new URL("https://fallback.example/x"));
    vi.stubGlobal("useRoute", () => ({
      path: "/guides/guide-1",
      params: {},
      query: {},
    }));
    useSeoMetaMock.mockClear();
  });

  afterEach(() => {
    stubOgMetaGlobals(useSeoMetaMock);
    vi.stubGlobal("useRoute", () => ({
      path: "/guides/guide-1",
      params: {},
      query: {},
    }));
  });

  it("uses the request origin when runtimeConfig.public.siteOrigin is blank", () => {
    useOgMeta(() => ({ pageTitle: "t", description: "d" }));

    const ogImage = lastSeoMetaCall(useSeoMetaMock).ogImage as () => string;
    expect(ogImage()).toBe("https://fallback.example/favicon.ico");
  });
});
