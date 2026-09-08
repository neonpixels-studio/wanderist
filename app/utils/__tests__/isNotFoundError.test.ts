import { describe, it, expect } from "vitest";
import { isNotFoundError } from "../isNotFoundError";

describe("isNotFoundError", () => {
  it("returns true for an ofetch FetchError carrying statusCode 404", () => {
    const error = Object.assign(new Error("Not Found"), { statusCode: 404 });
    expect(isNotFoundError(error)).toBe(true);
  });

  it("returns true for an error carrying response.status 404", () => {
    const error = Object.assign(new Error("Not Found"), {
      response: { status: 404 },
    });
    expect(isNotFoundError(error)).toBe(true);
  });

  it("returns true for an error carrying a nested data.statusCode 404", () => {
    const error = Object.assign(new Error("Not Found"), {
      data: { statusCode: 404 },
    });
    expect(isNotFoundError(error)).toBe(true);
  });

  it("returns false for a 500 error", () => {
    const error = Object.assign(new Error("Internal Server Error"), {
      statusCode: 500,
    });
    expect(isNotFoundError(error)).toBe(false);
  });

  it("returns false for a plain network error with no status", () => {
    expect(isNotFoundError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("returns false for a non-object thrown value", () => {
    expect(isNotFoundError("boom")).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });

  it("prefers statusCode over response.status when both are present", () => {
    const error = Object.assign(new Error("Conflict"), {
      statusCode: 409,
      response: { status: 404 },
    });
    expect(isNotFoundError(error)).toBe(false);
  });
});
