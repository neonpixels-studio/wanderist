import { describe, expect, it } from "vitest";
import {
  buildSecurityRouteRules,
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  SECURITY_HEADERS,
} from "../security-headers.config";

function getDirective(policy: string, name: string): string | undefined {
  return policy.split("; ").find((directive) => directive.startsWith(name));
}

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

  it("allows same-origin framing plus Cloudflare Turnstile", () => {
    expect(getDirective(CONTENT_SECURITY_POLICY_REPORT_ONLY, "frame-src")).toBe(
      "frame-src 'self' https://challenges.cloudflare.com",
    );
  });

  it("carries the 'unsafe-inline' script-src carve-out Nuxt's SSR hydration script needs", () => {
    expect(
      getDirective(CONTENT_SECURITY_POLICY_REPORT_ONLY, "script-src"),
    ).toContain("'unsafe-inline'");
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
    const connectSrc = getDirective(
      CONTENT_SECURITY_POLICY_REPORT_ONLY,
      "connect-src",
    );
    const imgSrc = getDirective(CONTENT_SECURITY_POLICY_REPORT_ONLY, "img-src");

    expect(connectSrc).toContain("https://api.mapbox.com");
    expect(connectSrc).toContain("https://events.mapbox.com");
    expect(connectSrc).toContain("https://*.tiles.mapbox.com");
    expect(imgSrc).toContain("https://api.mapbox.com");
    expect(imgSrc).toContain("https://*.tiles.mapbox.com");
  });

  it("allowlists both Sentry ingest host shapes in connect-src", () => {
    const connectSrc = getDirective(
      CONTENT_SECURITY_POLICY_REPORT_ONLY,
      "connect-src",
    );

    expect(connectSrc).toContain("https://*.ingest.sentry.io");
    expect(connectSrc).toContain("https://*.ingest.us.sentry.io");
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

describe("buildSecurityRouteRules", () => {
  it("applies SECURITY_HEADERS to every route in production", () => {
    expect(buildSecurityRouteRules("production")).toEqual({
      "/**": { headers: SECURITY_HEADERS },
    });
  });

  it("skips the enforcing headers outside production", () => {
    // X-Frame-Options: DENY would block Nuxt devtools' same-origin iframe,
    // and HSTS is host+port-agnostic, so it would force every other local
    // HTTPS dev server on the machine onto HTTPS too.
    expect(buildSecurityRouteRules("development")).toEqual({});
    expect(buildSecurityRouteRules("test")).toEqual({});
    expect(buildSecurityRouteRules(undefined)).toEqual({});
  });
});
