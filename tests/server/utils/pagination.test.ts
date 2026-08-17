import { describe, it, expect } from "vitest";
import {
  MAX_PAGE,
  parsePageParam,
  pageToOffset,
} from "../../../server/utils/pagination";

describe("parsePageParam", () => {
  it("returns the parsed page for a valid in-range value", () => {
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(7)).toBe(7);
  });

  it("accepts the MAX_PAGE boundary but clamps beyond it to page 1", () => {
    expect(parsePageParam(String(MAX_PAGE))).toBe(MAX_PAGE);
    expect(parsePageParam(MAX_PAGE + 1)).toBe(1);
  });

  it("falls back to page 1 for missing, zero, negative, or non-integer input", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam("")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-5")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("2.5")).toBe(1);
    expect(parsePageParam("1e300")).toBe(1);
  });
});

describe("pageToOffset", () => {
  it("maps page 1 to offset 0", () => {
    expect(pageToOffset(1, 50)).toBe(0);
  });

  it("multiplies the zero-based page index by the page size", () => {
    expect(pageToOffset(3, 50)).toBe(100);
    expect(pageToOffset(2, 20)).toBe(20);
  });
});
