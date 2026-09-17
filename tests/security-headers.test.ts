import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  SECURITY_HEADERS,
} from "../security-headers.config";

describe("SECURITY_HEADERS", () => {
  it("enforces HSTS, frame, content-type-sniffing, referrer, and permissions protections", () => {
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toContain(
      "max-age=63072000",
    );
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toContain(
      "includeSubDomains",
    );
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(SECURITY_HEADERS["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("ships CSP in Report-Only mode, not enforcing", () => {
    expect(
      SECURITY_HEADERS["Content-Security-Policy-Report-Only"],
    ).toBeDefined();
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toBeUndefined();
  });
});

describe("CONTENT_SECURITY_POLICY_REPORT_ONLY", () => {
  it("locks down defaults, framing, and form submission", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "frame-ancestors 'none'",
    );
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain("form-action 'self'");
  });

  it("allows same-origin framing (Nuxt devtools) plus Cloudflare Turnstile", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "frame-src 'self' https://challenges.cloudflare.com",
    );
  });

  it("allowlists the Clerk origins the embedded SignIn component and avatars need", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://*.clerk.accounts.dev",
    );
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://img.clerk.com",
    );
  });

  it("does not need Clerk's Backend API, since that's server-only", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).not.toContain(
      "https://api.clerk.com",
    );
  });

  it("allowlists Mapbox tiles/API in both connect-src and img-src", () => {
    const [connectSrcDirective] = CONTENT_SECURITY_POLICY_REPORT_ONLY.split(
      "; ",
    ).filter((directive) => directive.startsWith("connect-src"));
    const [imgSrcDirective] = CONTENT_SECURITY_POLICY_REPORT_ONLY.split(
      "; ",
    ).filter((directive) => directive.startsWith("img-src"));

    expect(connectSrcDirective).toContain("https://api.mapbox.com");
    expect(connectSrcDirective).toContain("https://events.mapbox.com");
    expect(connectSrcDirective).toContain("https://*.tiles.mapbox.com");
    expect(imgSrcDirective).toContain("https://api.mapbox.com");
    expect(imgSrcDirective).toContain("https://*.tiles.mapbox.com");
  });

  it("allowlists Google Fonts, which app/assets/css/main.css @imports", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://fonts.googleapis.com",
    );
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://fonts.gstatic.com",
    );
  });

  it("does not need Stripe origins, since checkout is a top-level redirect rather than client-side JS", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).not.toContain("stripe.com");
  });

  it("does not need Instagram origins, since media is re-hosted through our own /api/media route", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).not.toContain("instagram.com");
  });
});

describe("nuxt.config.ts wiring", () => {
  it("applies SECURITY_HEADERS to every route via routeRules", async () => {
    vi.stubGlobal("defineNuxtConfig", (config: unknown) => config);

    const { default: nuxtConfig } = (await import("../nuxt.config")) as {
      default: { routeRules?: Record<string, { headers?: unknown }> };
    };

    expect(nuxtConfig.routeRules?.["/**"]?.headers).toBe(SECURITY_HEADERS);

    vi.unstubAllGlobals();
  });
});
