/**
 * Unit tests for PATCH /api/account/avatar
 *
 * Clerk and auth utilities are mocked so no network access is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  stubCreateError,
  stubDefineEventHandler,
  buildAccountEvent,
  callHandler,
  assertThrows401WhenNotAuthenticated,
} from "./_helpers";
import { createFileTooLargeError } from "../../../server/utils/readCappedUploadBody";

// ---------------------------------------------------------------------------
// Hoist mock factories
// ---------------------------------------------------------------------------

const {
  mockRequireUser,
  mockClerkSetProfileImage,
  mockClerkRemoveProfileImage,
  mockGetHeader,
  mockGetQuery,
  mockReadCappedUploadBody,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockClerkSetProfileImage: vi
    .fn()
    .mockResolvedValue("https://cdn.clerk.com/avatar.jpg"),
  mockClerkRemoveProfileImage: vi.fn().mockResolvedValue(undefined),
  mockGetHeader: vi.fn(),
  mockGetQuery: vi.fn(),
  mockReadCappedUploadBody: vi.fn(),
}));

vi.mock("../../../server/utils/auth", () => ({
  requireUser: mockRequireUser,
}));

vi.mock("../../../server/utils/clerkAccount", () => ({
  clerkSetProfileImage: mockClerkSetProfileImage,
  clerkRemoveProfileImage: mockClerkRemoveProfileImage,
}));

// The size-cap streaming reader has its own dedicated coverage (both the
// Node-stream and Web-ReadableStream paths) in
// tests/server/utils/readCappedUploadBody.test.ts. This route's tests only
// need to verify the route's own logic — content-type/empty-body/early-check
// handling and wiring — so it's mocked here rather than driven through a
// real stream, mirroring tests/server/media.test.ts.
vi.mock("../../../server/utils/readCappedUploadBody", async () => {
  // Only the streaming reader is faked; `createFileTooLargeError` stays the
  // real implementation so this mock can't drift from its actual message.
  const actual = await vi.importActual<
    typeof import("../../../server/utils/readCappedUploadBody")
  >("../../../server/utils/readCappedUploadBody");
  return {
    readCappedUploadBody: mockReadCappedUploadBody,
    createFileTooLargeError: actual.createFileTooLargeError,
  };
});

stubDefineEventHandler();
stubCreateError();
Object.assign(globalThis, {
  getHeader: mockGetHeader,
  getQuery: mockGetQuery,
});

const { default: handler, MAX_AVATAR_SIZE_BYTES } =
  await import("../../../server/api/account/avatar.patch");

function stubUploadHeaders(contentType = "image/jpeg"): void {
  mockGetHeader.mockImplementation((_event: unknown, header: string) => {
    if (header === "content-type") {
      return contentType;
    }
    if (header === "content-length") {
      return "100";
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/account/avatar — upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({});
    stubUploadHeaders("image/jpeg");
    mockReadCappedUploadBody.mockResolvedValue(Buffer.from("fake-image"));
    mockClerkSetProfileImage.mockResolvedValue(
      "https://cdn.clerk.com/avatar.jpg",
    );
  });

  it("returns imageUrl on a successful upload", async () => {
    const result = (await callHandler(handler, buildAccountEvent())) as {
      imageUrl: string;
    };
    expect(result.imageUrl).toBe("https://cdn.clerk.com/avatar.jpg");
    expect(mockClerkSetProfileImage).toHaveBeenCalledWith(
      "user-1",
      expect.any(Blob),
    );
    // Proves the route asks the bounded reader for the avatar-specific cap
    // (not, say, the larger media-route limit, or no cap at all).
    expect(mockReadCappedUploadBody).toHaveBeenCalledWith(
      expect.anything(),
      MAX_AVATAR_SIZE_BYTES,
    );
  });

  it("throws 415 for a disallowed content type", async () => {
    stubUploadHeaders("image/gif");

    await expect(
      callHandler(handler, buildAccountEvent()),
    ).rejects.toMatchObject({ statusCode: 415 });
  });

  it("propagates the 413 thrown by the size-cap reader (e.g. a lying/oversized upload)", async () => {
    // The actual byte-counting and streaming abort live in
    // readCappedUploadBody (see tests/server/utils/readCappedUploadBody.test.ts);
    // this only proves the route doesn't swallow, wrap, or alter its
    // rejection. Building the error via the real (mock-passthrough)
    // `createFileTooLargeError` — rather than a hand-rolled Error — means
    // this test can't drift from the actual 413 message.
    const capError = createFileTooLargeError(MAX_AVATAR_SIZE_BYTES);
    mockReadCappedUploadBody.mockRejectedValue(capError);

    await expect(callHandler(handler, buildAccountEvent())).rejects.toBe(
      capError,
    );
  });

  it("throws 413 on Content-Length alone before reading the body (early check)", async () => {
    // Stub content-length one byte over the avatar cap so this exercises the
    // `>` boundary itself (an off-by-one, e.g. `>` becoming `>=`, would flip
    // this test) rather than an arbitrarily larger value.
    mockGetHeader.mockImplementation((_event: unknown, header: string) => {
      if (header === "content-type") {
        return "image/jpeg";
      }
      if (header === "content-length") {
        return String(MAX_AVATAR_SIZE_BYTES + 1);
      }
      return null;
    });

    await expect(
      callHandler(handler, buildAccountEvent()),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(mockReadCappedUploadBody).not.toHaveBeenCalled();
  });

  it("allows a Content-Length exactly at the avatar cap through the early check", async () => {
    mockGetHeader.mockImplementation((_event: unknown, header: string) => {
      if (header === "content-type") {
        return "image/jpeg";
      }
      if (header === "content-length") {
        return String(MAX_AVATAR_SIZE_BYTES);
      }
      return null;
    });

    await callHandler(handler, buildAccountEvent());

    expect(mockReadCappedUploadBody).toHaveBeenCalledWith(
      expect.anything(),
      MAX_AVATAR_SIZE_BYTES,
    );
  });

  it("does not block the early check on a non-numeric Content-Length header", async () => {
    // Number("not-a-number") is NaN, which fails every `>` comparison
    // harmlessly rather than being rejected outright, so the request
    // proceeds to the streaming cap (the real backstop) instead of trusting
    // an untrustworthy header directly. Mirrors the equivalent case in
    // tests/server/media.test.ts.
    mockGetHeader.mockImplementation((_event: unknown, header: string) => {
      if (header === "content-type") {
        return "image/jpeg";
      }
      if (header === "content-length") {
        return "not-a-number";
      }
      return null;
    });

    await callHandler(handler, buildAccountEvent());

    expect(mockReadCappedUploadBody).toHaveBeenCalledWith(
      expect.anything(),
      MAX_AVATAR_SIZE_BYTES,
    );
  });

  it("throws 400 for an empty body", async () => {
    mockReadCappedUploadBody.mockResolvedValue(null);

    await expect(
      callHandler(handler, buildAccountEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 401 when requireUser throws", async () => {
    await assertThrows401WhenNotAuthenticated(mockRequireUser, handler);
  });

  it("accepts image/png in addition to image/jpeg", async () => {
    stubUploadHeaders("image/png");

    const result = (await callHandler(handler, buildAccountEvent())) as {
      imageUrl: string;
    };
    expect(result.imageUrl).toBe("https://cdn.clerk.com/avatar.jpg");
  });
});

describe("PATCH /api/account/avatar — remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockReturnValue("user-1");
    mockGetQuery.mockReturnValue({ action: "remove" });
    mockClerkRemoveProfileImage.mockResolvedValue(undefined);
  });

  it("returns ok when removing the avatar", async () => {
    const result = await callHandler(handler, buildAccountEvent());
    expect(result).toEqual({ ok: true });
    expect(mockClerkRemoveProfileImage).toHaveBeenCalledWith("user-1");
  });

  it("throws 401 when requireUser throws on remove", async () => {
    await assertThrows401WhenNotAuthenticated(mockRequireUser, handler);
  });
});
