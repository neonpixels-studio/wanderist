import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

const { useMediaUpload } = await import("../useMediaUpload");

describe("useMediaUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildFile(
    name = "photo.jpg",
    type = "image/jpeg",
    size = 1024,
  ): File {
    return new File([new ArrayBuffer(size)], name, { type });
  }

  it("returns id and url from a successful upload", async () => {
    mockFetch.mockResolvedValue({
      id: "media-123",
      url: "/api/media/media-123",
    });
    const { upload } = useMediaUpload();

    const result = await upload(buildFile());

    expect(result).toEqual({ id: "media-123", url: "/api/media/media-123" });
  });

  it("calls $fetch with POST, the file content-type, and an ArrayBuffer body", async () => {
    mockFetch.mockResolvedValue({ id: "m1", url: "/api/media/m1" });
    const { upload } = useMediaUpload();

    await upload(buildFile("img.png", "image/png"));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/media",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: expect.any(ArrayBuffer),
      }),
    );
  });

  it("sets isUploading to true during the upload and false after", async () => {
    let capturedDuringUpload = false;
    mockFetch.mockImplementation(async () => {
      capturedDuringUpload = true;
      return { id: "m1", url: "/api/media/m1" };
    });

    const { upload, isUploading } = useMediaUpload();

    expect(isUploading.value).toBe(false);
    await upload(buildFile());
    expect(capturedDuringUpload).toBe(true);
    expect(isUploading.value).toBe(false);
  });

  it("sets error to null and rethrows when $fetch rejects with a raw Error", async () => {
    const uploadError = new Error("Network failure");
    mockFetch.mockRejectedValue(uploadError);
    const { upload, error } = useMediaUpload();

    await expect(upload(buildFile())).rejects.toThrow("Network failure");
    // Null (not a fallback string) so the caller can apply its own
    // context-specific fallback message instead of a generic one.
    expect(error.value).toBeNull();
  });

  // Regression guard: a raw Error's `.message` can carry framework/network
  // diagnostic text (stack-shaped strings, internal implementation detail)
  // that was never meant for a user to see. extractServerErrorMessage never
  // returns it — the ref is null unless the server deliberately chose to
  // surface a statusMessage (see app/utils/extractErrorMessage.ts).
  it("never surfaces a raw diagnostic error message to the user-facing error ref", async () => {
    const diagnosticError = new TypeError(
      "Cannot read properties of undefined (reading 'foo') at fetchInternal (chunk-XYZ.js:42:17)",
    );
    mockFetch.mockRejectedValue(diagnosticError);
    const { upload, error } = useMediaUpload();

    await upload(buildFile()).catch(() => {});

    expect(error.value).toBeNull();
  });

  it("surfaces the server's own statusMessage when it deliberately provided one", async () => {
    const serverError = Object.assign(new Error("Request failed"), {
      data: { statusMessage: "File too large" },
    });
    mockFetch.mockRejectedValue(serverError);
    const { upload, error } = useMediaUpload();

    await upload(buildFile()).catch(() => {});

    expect(error.value).toBe("File too large");
  });

  it("clears error from a previous failed upload on a new successful upload", async () => {
    mockFetch
      .mockRejectedValueOnce(
        Object.assign(new Error("First failure"), {
          data: { statusMessage: "First failure" },
        }),
      )
      .mockResolvedValue({ id: "m2", url: "/api/media/m2" });

    const { upload, error } = useMediaUpload();

    await upload(buildFile()).catch(() => {});
    expect(error.value).toBe("First failure");

    await upload(buildFile());
    expect(error.value).toBeNull();
  });

  it("sets isUploading back to false after a failed upload", async () => {
    mockFetch.mockRejectedValue(new Error("Oops"));
    const { upload, isUploading } = useMediaUpload();

    await upload(buildFile()).catch(() => {});

    expect(isUploading.value).toBe(false);
  });
});
