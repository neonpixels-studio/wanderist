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

  it("returns statusMessage from a direct H3 error object", () => {
    const error = Object.assign(new Error("Bad Request"), {
      statusMessage: "Trip title is required",
    });
    expect(extractErrorMessage(error)).toBe("Trip title is required");
  });

  it("prefers data.statusMessage over a top-level statusMessage when both are present", () => {
    const error = Object.assign(new Error("Bad Request"), {
      statusMessage: "top-level",
      data: { statusMessage: "nested wins" },
    });
    expect(extractErrorMessage(error)).toBe("nested wins");
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

  it("falls back to the generic message for a plain string thrown value", () => {
    expect(extractErrorMessage("plain string error")).toBe(
      UNEXPECTED_ERROR_MESSAGE,
    );
  });

  it("falls back to the generic message for null and undefined", () => {
    expect(extractErrorMessage(null)).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(extractErrorMessage(undefined)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("falls back to the generic message when statusMessage is an empty string", () => {
    const error = Object.assign(new Error("boom"), { statusMessage: "" });
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("ignores a non-string statusMessage and falls through", () => {
    const error = Object.assign(new Error("boom"), { statusMessage: 500 });
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("falls through to the top-level statusMessage when data.statusMessage is an empty string", () => {
    const error = Object.assign(new Error("boom"), {
      statusMessage: "top-level fallback",
      data: { statusMessage: "" },
    });
    expect(extractErrorMessage(error)).toBe("top-level fallback");
  });

  it("falls through to the top-level statusMessage when data is not an object", () => {
    const error = Object.assign(new Error("boom"), {
      statusMessage: "top-level fallback",
      data: "not an object",
    });
    expect(extractErrorMessage(error)).toBe("top-level fallback");
  });

  it("ignores a non-string data.statusMessage and falls through", () => {
    const error = Object.assign(new Error("boom"), {
      data: { statusMessage: 500 },
    });
    expect(extractErrorMessage(error)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });
});
