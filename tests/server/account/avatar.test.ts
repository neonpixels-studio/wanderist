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

const { default: handler } =
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
    // this only proves the route doesn't swallow or alter its rejection.
    mockReadCappedUploadBody.mockRejectedValue(
      Object.assign(new Error("File too large. Maximum size is 4 MB"), {
        statusCode: 413,
      }),
    );

    await expect(
      callHandler(handler, buildAccountEvent()),
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it("throws 413 on Content-Length alone before reading the body (early check)", async () => {
    // Stub content-length to exceed the 4 MB avatar limit; the early gate
    // should fire before the bounded reader is ever invoked.
    mockGetHeader.mockImplementation((_event: unknown, header: string) => {
      if (header === "content-type") {
        return "image/jpeg";
      }
      if (header === "content-length") {
        return String(5 * 1024 * 1024);
      }
      return null;
    });

    await expect(
      callHandler(handler, buildAccountEvent()),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(mockReadCappedUploadBody).not.toHaveBeenCalled();
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
