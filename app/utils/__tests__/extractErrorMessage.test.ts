import { describe, it, expect } from "vitest";
import { extractErrorMessage } from "../extractErrorMessage";

const UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred";

describe("extractErrorMessage", () => {
  it("returns the nested data.statusMessage from an ofetch-wrapped Nitro error", () => {
    const error = Object.assign(new Error("[GET] 400"), {
      data: { statusMessage: "Email already in use" },
    });
    expect(extractErrorMessage(error)).toBe("Email already in use");
  });

  it("never surfaces a raw Error message — falls back to the generic message instead", () => {
    expect(extractErrorMessage(new Error("Failed to fetch"))).toBe(
      UNEXPECTED_ERROR_MESSAGE,
    );
  });

  it("never surfaces a raw network TypeError message", () => {
    expect(
      extractErrorMessage(
        new TypeError("NetworkError when attempting to fetch resource"),
      ),
    ).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("never surfaces ofetch's own composed message when there is no statusMessage", () => {
    const error = Object.assign(
      new Error('[GET] "/api/trips": 500 Internal Server Error'),
      { data: { statusCode: 500 } },
    );
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("never surfaces a diagnostic message from a client-thrown Error", () => {
    const error = new Error(
      "Malformed /api/trips response: expected { trips: Trip[], hasMore: boolean }",
    );
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  // ofetch mirrors the raw HTTP reason phrase (response.statusText) onto a
  // top-level `.statusMessage` for EVERY fetch error that got a response —
  // including infra failures our own server never touched (a Netlify/CDN
  // 502, a proxy timeout). A bare top-level statusMessage with no `data`
  // wrapper is exactly that shape, so it must never be trusted.
  it("never surfaces a bare top-level statusMessage (ofetch's raw HTTP reason phrase)", () => {
    const error = Object.assign(new Error('[GET] "/api/trips": 502'), {
      statusMessage: "Bad Gateway",
    });
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("falls back to the generic message for a plain string thrown value", () => {
    expect(extractErrorMessage("plain string error")).toBe(
      UNEXPECTED_ERROR_MESSAGE,
    );
  });

  it("falls back to the generic message for null and undefined", () => {
    expect(extractErrorMessage(null)).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(extractErrorMessage(undefined)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("falls back to the generic message when data.statusMessage is an empty string", () => {
    const error = Object.assign(new Error("boom"), {
      data: { statusMessage: "" },
    });
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("falls back to the generic message when data.statusMessage is whitespace-only", () => {
    const error = Object.assign(new Error("boom"), {
      data: { statusMessage: "   " },
    });
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("trims surrounding whitespace from a real data.statusMessage", () => {
    const error = Object.assign(new Error("boom"), {
      data: { statusMessage: "  Email already in use  " },
    });
    expect(extractErrorMessage(error)).toBe("Email already in use");
  });

  it("falls back to the generic message when data is not an object", () => {
    const error = Object.assign(new Error("boom"), { data: "not an object" });
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("ignores a non-string data.statusMessage and falls back to the generic message", () => {
    const error = Object.assign(new Error("boom"), {
      data: { statusMessage: 500 },
    });
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });
});
