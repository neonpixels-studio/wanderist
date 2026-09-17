import { describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  SECURITY_HEADERS,
} from "../security-headers.config";

describe("SECURITY_HEADERS", () => {
  it("enforces HSTS, frame, content-type-sniffing, and referrer protections", () => {
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

  it("allowlists the Clerk origins the embedded SignIn component and avatars need", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://*.clerk.accounts.dev",
    );
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://api.clerk.com",
    );
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://img.clerk.com",
    );
  });

  it("allowlists Mapbox for the map page", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://api.mapbox.com",
    );
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "https://events.mapbox.com",
    );
  });

  it("does not need Stripe origins, since checkout is a top-level redirect rather than client-side JS", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).not.toContain("stripe.com");
  });

  it("does not need Instagram origins, since media is re-hosted through our own /api/media route", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).not.toContain("instagram.com");
  });
});
