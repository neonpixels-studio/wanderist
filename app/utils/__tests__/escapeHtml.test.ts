import { describe, it, expect } from "vitest";
import { escapeHtml } from "../escapeHtml";

describe("escapeHtml", () => {
  it("returns plain text unchanged", () => {
    expect(escapeHtml("Reykjavík")).toBe("Reykjavík");
  });

  it("escapes angle brackets so tags render inert", () => {
    expect(escapeHtml("<img src=x onerror=alert(1)>")).toBe(
      "&lt;img src=x onerror=alert(1)&gt;",
    );
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("Route & stops")).toBe("Route &amp; stops");
  });

  it("escapes ampersands before other entities (no double-encoding)", () => {
    expect(escapeHtml("<a>")).toBe("&lt;a&gt;");
  });

  it("escapes quotes", () => {
    expect(escapeHtml(`"quoted" and 'single'`)).toBe(
      "&quot;quoted&quot; and &#39;single&#39;",
    );
  });

  it("returns an empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });
});
