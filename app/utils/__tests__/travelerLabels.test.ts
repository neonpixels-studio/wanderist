import { describe, it, expect } from "vitest";
import { DEFAULT_TRAVELER_NAME, formatHandle } from "../travelerLabels";

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
