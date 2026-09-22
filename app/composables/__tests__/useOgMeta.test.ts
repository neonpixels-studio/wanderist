import { describe, it, expect, vi, beforeEach } from "vitest";
import { useOgMeta } from "../useOgMeta";

const useSeoMetaMock = vi.fn();
vi.stubGlobal("useSeoMeta", useSeoMetaMock);

// Fixed site origin so every absolute-URL assertion below is deterministic,
// overriding the blank default in vitest.setup.ts (kept blank there so the
// billing-route tests can assert on a missing site origin).
vi.stubGlobal("useRuntimeConfig", () => ({
  public: { siteOrigin: "https://wanderist.test" },
}));
vi.stubGlobal("useRequestURL", () => new URL("https://wanderist.test/"));

function lastSeoMetaCall(): Record<string, unknown> {
  const call = useSeoMetaMock.mock.calls.at(-1)?.[0] as
    Record<string, unknown> | undefined;
  expect(call).toBeDefined();
  return call as Record<string, unknown>;
}

describe("useOgMeta", () => {
  beforeEach(() => {
    useSeoMetaMock.mockClear();
  });

  it("builds title, description, and og/twitter fields from the given input", () => {
    useOgMeta(() => ({
      title: "Wanderist — Tokyo on foot",
      description: "Start in Yanaka at sunrise.",
    }));

    const meta = lastSeoMetaCall();
    const title = meta.title as () => string;
    const description = meta.description as () => string;

    expect(title()).toBe("Wanderist — Tokyo on foot");
    expect((meta.ogTitle as () => string)()).toBe(title());
    expect((meta.twitterTitle as () => string)()).toBe(title());
    expect(description()).toBe("Start in Yanaka at sunrise.");
    expect((meta.ogDescription as () => string)()).toBe(description());
    expect((meta.twitterDescription as () => string)()).toBe(description());
    expect(meta.ogType).toBe("website");
    expect(meta.twitterCard).toBe("summary_large_image");
  });

  it("falls back to the site favicon, as an absolute URL, when no image path is given", () => {
    useOgMeta(() => ({ title: "t", description: "d" }));

    const ogImage = lastSeoMetaCall().ogImage as () => string;
    expect(ogImage()).toBe("https://wanderist.test/favicon.ico");
  });

  it("builds an absolute image URL from a site-relative image path", () => {
    useOgMeta(() => ({
      title: "t",
      description: "d",
      imagePath: "/api/media/media-1",
    }));

    const meta = lastSeoMetaCall();
    const ogImage = meta.ogImage as () => string;
    const twitterImage = meta.twitterImage as () => string;

    expect(ogImage()).toBe("https://wanderist.test/api/media/media-1");
    expect(twitterImage()).toBe(ogImage());
  });

  it("truncates an overly long description rather than emitting it verbatim", () => {
    const longDescription = "x".repeat(500);

    useOgMeta(() => ({ title: "t", description: longDescription }));

    const description = lastSeoMetaCall().description as () => string;
    const result = description();
    expect(result.length).toBe(200);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves a short description untouched", () => {
    useOgMeta(() => ({ title: "t", description: "short and sweet" }));

    const description = lastSeoMetaCall().description as () => string;
    expect(description()).toBe("short and sweet");
  });

  it("builds an absolute og:url from the current request path", () => {
    useOgMeta(() => ({ title: "t", description: "d" }));

    const ogUrl = lastSeoMetaCall().ogUrl as () => string;
    expect(ogUrl()).toMatch(/^https:\/\/wanderist\.test\//);
  });
});
