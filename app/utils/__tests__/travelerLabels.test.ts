import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRAVELER_NAME,
  formatAuthorByline,
  formatHandle,
} from "../travelerLabels";

describe("formatHandle", () => {
  it("prefixes a bare handle with a single @", () => {
    expect(formatHandle("elsa_far")).toBe("@elsa_far");
  });

  it("does not double up an existing @", () => {
    expect(formatHandle("@elsa_far")).toBe("@elsa_far");
  });

  it("collapses repeated leading @ down to one", () => {
    expect(formatHandle("@@elsa")).toBe("@elsa");
  });

  it("returns an empty string for a null or empty handle", () => {
    expect(formatHandle(null)).toBe("");
    expect(formatHandle(undefined)).toBe("");
    expect(formatHandle("")).toBe("");
  });
});

describe("DEFAULT_TRAVELER_NAME", () => {
  it("is the shared fallback label", () => {
    expect(DEFAULT_TRAVELER_NAME).toBe("Wanderist traveler");
  });
});

describe("formatAuthorByline", () => {
  it("prefers the handle over the display name", () => {
    expect(formatAuthorByline("elsa_far", "Elsa")).toBe("by @elsa_far");
  });

  it("falls back to the display name when there is no handle", () => {
    expect(formatAuthorByline(null, "Elsa")).toBe("by Elsa");
  });

  it("falls back to a generic label when both are missing", () => {
    expect(formatAuthorByline(null, null)).toBe("by a traveler");
    expect(formatAuthorByline(undefined, undefined)).toBe("by a traveler");
  });

  it("falls back to a generic label when the display name is an empty string", () => {
    expect(formatAuthorByline(null, "")).toBe("by a traveler");
  });
});
