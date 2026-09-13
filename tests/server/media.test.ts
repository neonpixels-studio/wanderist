/**
 * Unit tests for the media API handlers.
 *
 * The Netlify Blobs store abstraction and the database are mocked so no network
 * or database access is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "node:stream";

// ---------------------------------------------------------------------------
// Hoist mock factories so they are available inside vi.mock() closures, which
// Vitest hoists before any import runs.
// ---------------------------------------------------------------------------

const {
  mockEnsureUser,
  mockRequireUser,
  mockPutMediaBlob,
  mockGetMediaBlob,
  mockRemoveMediaBlob,
  mockToThumbnailKey,
  mockProbeImageDimensions,
  mockGenerateThumbnail,
  mockDbInsertValues,
  mockDbInsertReturning,
  mockDbSelectFrom,
  mockDbSelectWhere,
  mockDbSelectLimit,
  mockDbDeleteWhere,
  mockGetDb,
  mockGetRouterParam,
  mockGetHeader,
  mockSetResponseHeader,
  mockSetResponseStatus,
} = vi.hoisted(() => {
  const mockDbInsertReturning = vi
    .fn()
    .mockResolvedValue([{ id: "media-123", url: "user-1/media-123" }]);
  const mockDbInsertValues = vi.fn(() => ({
    returning: mockDbInsertReturning,
  }));
  const mockDbInsert = vi.fn(() => ({ values: mockDbInsertValues }));

  const mockDbDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockDbDelete = vi.fn(() => ({ where: mockDbDeleteWhere }));

  const mockDbSelectLimit = vi.fn().mockResolvedValue([]);
  const mockDbSelectWhere = vi.fn(() => ({ limit: mockDbSelectLimit }));
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectWhere }));
  const mockDbSelect = vi.fn(() => ({ from: mockDbSelectFrom }));

  const mockGetDb = vi.fn(() => ({
    insert: mockDbInsert,
    delete: mockDbDelete,
    select: mockDbSelect,
  }));

  return {
    mockEnsureUser: vi.fn(),
    mockRequireUser: vi.fn(),
    mockPutMediaBlob: vi.fn().mockResolvedValue(undefined),
    mockGetMediaBlob: vi.fn(),
    mockRemoveMediaBlob: vi.fn().mockResolvedValue(undefined),
    // Mirrors the real implementation's suffix convention so route tests can
    // assert on the derived key without re-mocking it per test.
    mockToThumbnailKey: vi.fn((storageKey: string) => `${storageKey}-thumb`),
    mockProbeImageDimensions: vi.fn(),
    mockGenerateThumbnail: vi.fn(),
    mockDbInsertValues,
    mockDbInsertReturning,
    mockDbSelectFrom,
    mockDbSelectWhere,
    mockDbSelectLimit,
    mockDbDeleteWhere,
    mockGetDb,
    mockGetRouterParam: vi.fn(),
    mockGetHeader: vi.fn(),
    mockSetResponseHeader: vi.fn(),
    mockSetResponseStatus: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("../../server/utils/auth", () => ({
  ensureUser: mockEnsureUser,
  requireUser: mockRequireUser,
}));

vi.mock("../../server/utils/mediaStore", () => ({
  putMediaBlob: mockPutMediaBlob,
  getMediaBlob: mockGetMediaBlob,
  removeMediaBlob: mockRemoveMediaBlob,
  toThumbnailKey: mockToThumbnailKey,
}));

vi.mock("../../server/utils/imageProcessing", () => ({
  probeImageDimensions: mockProbeImageDimensions,
  generateThumbnail: mockGenerateThumbnail,
}));

vi.mock("../../server/db/index", () => ({
  getDb: mockGetDb,
}));

const mockAssertPhotoLimit = vi.fn().mockResolvedValue(undefined);
vi.mock("../../server/utils/planLimits", () => ({
  assertPhotoLimit: mockAssertPhotoLimit,
}));

// Stub Nitro/h3 auto-imports
Object.assign(globalThis, {
  defineEventHandler: (handler: (event: object) => unknown) => handler,
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
  getRouterParam: mockGetRouterParam,
  getHeader: mockGetHeader,
  setResponseHeader: mockSetResponseHeader,
  setResponseStatus: mockSetResponseStatus,
  // Returns "https" to simulate a production request; tests assert on the path only.
  getRequestProtocol: () => "https",
});

// ---------------------------------------------------------------------------
// Import handlers after mocks
// ---------------------------------------------------------------------------

const { default: postHandler } =
  await import("../../server/api/media/index.post");
const { default: deleteHandler } =
  await import("../../server/api/media/[id].delete");
const { default: getHandler } = await import("../../server/api/media/[id].get");
const { default: thumbnailGetHandler } =
  await import("../../server/api/media/[id]/thumbnail.get");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type H3Event = object;

function buildEvent(): H3Event {
  return { context: { userId: "user-1" }, node: { req: { socket: true } } };
}

// The media POST handler reads the upload body directly off `event.node.req`
// (a real Node stream) rather than via a mocked `readRawBody`, so its tests
// need a real stream to write bytes into. A PassThrough buffers whatever is
// written before a reader attaches, so writing (and optionally ending) it
// before the handler is invoked is safe — the handler's later `data`/`end`
// listeners still receive everything already written.
function buildUploadEvent(bodyChunks: Buffer[]): H3Event {
  const req = new PassThrough();
  for (const chunk of bodyChunks) {
    req.write(chunk);
  }
  req.end();
  return { context: { userId: "user-1" }, node: { req } };
}

function callHandler(handler: unknown, event: H3Event): Promise<unknown> {
  return (handler as (event: H3Event) => Promise<unknown>)(event);
}

function resetDbMocks() {
  mockDbInsertReturning.mockResolvedValue([
    { id: "media-123", url: "user-1/media-123" },
  ]);
  mockDbSelectLimit.mockResolvedValue([]);
}

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function stubHeaders(contentType: string): void {
  mockGetHeader.mockImplementation((_event: unknown, header: string) => {
    if (header === "content-type") {
      return contentType;
    }
    if (header === "host") {
      return "localhost:3000";
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// POST /api/media
// ---------------------------------------------------------------------------

const sampleUploadBuffer = Buffer.from("fake-image-data");

describe("POST /api/media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureUser.mockResolvedValue("user-1");
    stubHeaders("image/jpeg");
    resetDbMocks();
    mockAssertPhotoLimit.mockResolvedValue(undefined);
    // Reset to the default resolved behavior in case a previous test in this
    // file overrode it with mockImplementation (vi.clearAllMocks() clears
    // call history but not a previously assigned implementation).
    mockPutMediaBlob.mockReset().mockResolvedValue(undefined);
    mockToThumbnailKey.mockImplementation(
      (storageKey: string) => `${storageKey}-thumb`,
    );
    mockProbeImageDimensions.mockResolvedValue({ width: 800, height: 600 });
    mockGenerateThumbnail.mockResolvedValue(Buffer.from("thumb-bytes"));
  });

  it("propagates a 402 when the plan's photo-storage limit has been reached", async () => {
    mockAssertPhotoLimit.mockRejectedValue(
      Object.assign(new Error("Plan limit reached"), { statusCode: 402 }),
    );

    await expect(
      callHandler(postHandler, buildUploadEvent([sampleUploadBuffer])),
    ).rejects.toMatchObject({
      statusCode: 402,
    });
    expect(mockAssertPhotoLimit).toHaveBeenCalledWith("user-1");
    expect(mockPutMediaBlob).not.toHaveBeenCalled();
  });

  it("returns 201 with id, url, dimensions, and thumbnailUrl on success", async () => {
    const result = (await callHandler(
      postHandler,
      buildUploadEvent([sampleUploadBuffer]),
    )) as {
      id: string;
      url: string;
      width: number | null;
      height: number | null;
      thumbnailUrl: string | null;
    };

    // The DB insert returns media-123 but the URL uses the UUID generated
    // before the insert. Assert structural shape rather than exact values.
    expect(result.id).toBe("media-123");
    expect(result.url).toMatch(/\/api\/media\//);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.thumbnailUrl).toMatch(/\/api\/media\/.+\/thumbnail/);
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
  });

  it("calls putMediaBlob with the correct key pattern and content type", async () => {
    await callHandler(postHandler, buildUploadEvent([sampleUploadBuffer]));

    expect(mockPutMediaBlob).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\//),
      expect.any(Buffer),
      "image/jpeg",
    );
  });

  it("probes dimensions and passes width/height through to the DB insert", async () => {
    mockProbeImageDimensions.mockResolvedValue({ width: 1024, height: 768 });

    await callHandler(postHandler, buildUploadEvent([sampleUploadBuffer]));

    expect(mockProbeImageDimensions).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1024, height: 768 }),
    );
  });

  it("stores the thumbnail under the derived key alongside the original", async () => {
    await callHandler(postHandler, buildUploadEvent([sampleUploadBuffer]));

    expect(mockGenerateThumbnail).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mockPutMediaBlob).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\/.+-thumb$/),
      Buffer.from("thumb-bytes"),
      "image/jpeg",
    );
  });

  it("stores null width/height and skips the thumbnail blob when probing/generation fails", async () => {
    mockProbeImageDimensions.mockResolvedValue(null);
    mockGenerateThumbnail.mockResolvedValue(null);

    const result = (await callHandler(
      postHandler,
      buildUploadEvent([sampleUploadBuffer]),
    )) as {
      width: number | null;
      height: number | null;
      thumbnailUrl: string | null;
    };

    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
    expect(result.thumbnailUrl).toBeNull();
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ width: null, height: null }),
    );
    // Only the original blob is written; no thumbnail key is put.
    expect(mockPutMediaBlob).toHaveBeenCalledTimes(1);
  });

  it("degrades to no thumbnail (still 201, width/height still populated) when storing the thumbnail blob fails", async () => {
    mockPutMediaBlob.mockImplementation((key: string) => {
      if (key.endsWith("-thumb")) {
        return Promise.reject(new Error("Blob store unavailable"));
      }
      return Promise.resolve(undefined);
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = (await callHandler(
      postHandler,
      buildUploadEvent([sampleUploadBuffer]),
    )) as {
      width: number | null;
      height: number | null;
      thumbnailUrl: string | null;
    };

    // The upload itself still succeeds: the original was already stored
    // before the thumbnail store was attempted, and probing is independent.
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.thumbnailUrl).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    // Insert is not told about a thumbnail that failed to persist, and no
    // cleanup of the (successfully stored) original is triggered.
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600 }),
    );
    expect(mockRemoveMediaBlob).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("throws 415 for a disallowed content type", async () => {
    stubHeaders("application/pdf");

    await expect(
      callHandler(postHandler, buildUploadEvent([sampleUploadBuffer])),
    ).rejects.toMatchObject({
      statusCode: 415,
    });
  });

  it("throws 400 for an empty body", async () => {
    await expect(
      callHandler(postHandler, buildUploadEvent([])),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 413 when the actual byte length exceeds the limit (streaming check)", async () => {
    const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024);

    await expect(
      callHandler(postHandler, buildUploadEvent([oversizedBuffer])),
    ).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it("throws 413 on Content-Length alone before reading the body (early check)", async () => {
    // Stub content-length to exceed the limit; body is small so only the early
    // check fires, not the streaming backstop.
    mockGetHeader.mockImplementation((_event: unknown, header: string) => {
      if (header === "content-type") {
        return "image/jpeg";
      }
      if (header === "content-length") {
        return String(11 * 1024 * 1024);
      }
      if (header === "host") {
        return "localhost:3000";
      }
      return null;
    });
    const event = buildUploadEvent([sampleUploadBuffer]);

    await expect(callHandler(postHandler, event)).rejects.toMatchObject({
      statusCode: 413,
    });
    // The body stream is never read; the early check fires first, so no
    // `data`/`end` listeners were ever attached to it.
    const req = (event as { node: { req: PassThrough } }).node.req;
    expect(req.listenerCount("data")).toBe(0);
  });

  it("aborts the stream before consuming the full body when a client omits or understates Content-Length", async () => {
    // No Content-Length header at all — the early check can't catch this,
    // so only the streaming byte cap can stop an oversized upload.
    mockGetHeader.mockImplementation((_event: unknown, header: string) => {
      if (header === "content-type") {
        return "image/jpeg";
      }
      if (header === "host") {
        return "localhost:3000";
      }
      return null;
    });

    const req = new PassThrough();
    // Once the cap trips, the handler destroys `req` while this loop may
    // still be mid-write; that can surface a stray write-after-destroy
    // stream error that has nothing to do with what this test asserts, so
    // it's swallowed here rather than left to fail the run as unhandled.
    req.on("error", () => {});
    const event = { context: { userId: "user-1" }, node: { req } };
    const chunk = Buffer.alloc(1024 * 1024); // 1 MB
    const totalChunksAvailable = 50; // simulates a 50 MB upload against the 10 MB cap

    const handlerPromise = callHandler(postHandler, event);
    let aborted = false;
    handlerPromise.catch(() => {
      aborted = true;
    });

    let chunksSent = 0;
    for (let index = 0; index < totalChunksAvailable; index += 1) {
      if (aborted || req.destroyed) {
        break;
      }
      req.write(chunk);
      chunksSent += 1;
      // Yield so the handler's `data` listener (and a possible `destroy()`
      // once the cap is exceeded) runs between writes.
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (!req.destroyed) {
      req.end();
    }

    await expect(handlerPromise).rejects.toMatchObject({ statusCode: 413 });
    expect(req.destroyed).toBe(true);
    // Proves the handler aborted well before the full (simulated) 50 MB
    // upload was sent — it never buffered anywhere close to the whole body.
    expect(chunksSent).toBeLessThan(totalChunksAvailable);
  });

  it("throws 401 when the user is not authenticated", async () => {
    const authError = Object.assign(new Error("Unauthorized"), {
      statusCode: 401,
    });
    mockEnsureUser.mockRejectedValue(authError);

    await expect(
      callHandler(postHandler, buildUploadEvent([sampleUploadBuffer])),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("accepts content-type with parameters (e.g. image/jpeg; charset=binary)", async () => {
    stubHeaders("image/jpeg; charset=binary");

    const result = (await callHandler(
      postHandler,
      buildUploadEvent([sampleUploadBuffer]),
    )) as {
      id: string;
      url: string;
    };
    expect(result.id).toBe("media-123");
    // Blob should be stored with the stripped content type.
    expect(mockPutMediaBlob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      "image/jpeg",
    );
  });

  it("removes the original and thumbnail blobs when the DB insert fails to prevent orphaned storage", async () => {
    const insertError = new Error("DB error");
    mockDbInsertReturning.mockRejectedValue(insertError);

    await expect(
      callHandler(postHandler, buildUploadEvent([sampleUploadBuffer])),
    ).rejects.toThrow("DB error");
    expect(mockPutMediaBlob).toHaveBeenCalled();
    expect(mockRemoveMediaBlob).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\//),
    );
    expect(mockRemoveMediaBlob).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\/.+-thumb$/),
    );
  });

  it("removes only the original blob on insert failure when no thumbnail was generated", async () => {
    mockGenerateThumbnail.mockResolvedValue(null);
    const insertError = new Error("DB error");
    mockDbInsertReturning.mockRejectedValue(insertError);

    await expect(
      callHandler(postHandler, buildUploadEvent([sampleUploadBuffer])),
    ).rejects.toThrow("DB error");
    expect(mockRemoveMediaBlob).toHaveBeenCalledTimes(1);
    expect(mockRemoveMediaBlob).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\//),
    );
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/media/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/media/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockReturnValue("user-1");
    mockGetRouterParam.mockReturnValue("media-123");
    mockDbSelectLimit.mockResolvedValue([{ url: "user-1/media-123" }]);
  });

  it("deletes the original blob, the thumbnail blob, and the database row on success", async () => {
    const result = await callHandler(deleteHandler, buildEvent());

    expect(mockRemoveMediaBlob).toHaveBeenCalledWith("user-1/media-123");
    expect(mockRemoveMediaBlob).toHaveBeenCalledWith("user-1/media-123-thumb");
    expect(mockDbDeleteWhere).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("still deletes the DB row and returns ok when the thumbnail blob removal fails", async () => {
    mockRemoveMediaBlob.mockImplementation((key: string) => {
      if (key.endsWith("-thumb")) {
        return Promise.reject(new Error("Thumbnail blob missing"));
      }
      return Promise.resolve(undefined);
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await callHandler(deleteHandler, buildEvent());

    expect(result).toEqual({ ok: true });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("throws 404 when the media row does not exist", async () => {
    mockDbSelectLimit.mockResolvedValue([]);

    await expect(
      callHandler(deleteHandler, buildEvent()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRemoveMediaBlob).not.toHaveBeenCalled();
  });

  it("throws 404 when the row belongs to another user (ownership scoping)", async () => {
    // The query includes a userId constraint so no row is returned.
    mockDbSelectLimit.mockResolvedValue([]);

    await expect(
      callHandler(deleteHandler, buildEvent()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 401 when the user is not authenticated", async () => {
    const authError = Object.assign(new Error("Unauthorized"), {
      statusCode: 401,
    });
    mockRequireUser.mockImplementation(() => {
      throw authError;
    });

    await expect(
      callHandler(deleteHandler, buildEvent()),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 when the route param is missing", async () => {
    mockGetRouterParam.mockReturnValue(undefined);

    await expect(
      callHandler(deleteHandler, buildEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns ok and logs when blob removal fails (no cascade error to caller)", async () => {
    mockRemoveMediaBlob.mockRejectedValue(new Error("Blob store unavailable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await callHandler(deleteHandler, buildEvent());

    expect(result).toEqual({ ok: true });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// GET /api/media/[id]
// ---------------------------------------------------------------------------

describe("GET /api/media/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockReturnValue("media-123");
    mockDbSelectLimit.mockResolvedValue([
      { url: "user-1/media-123", contentType: "image/jpeg" },
    ]);
    mockGetMediaBlob.mockResolvedValue({
      data: new ArrayBuffer(8),
      contentType: "image/jpeg",
    });
  });

  it("returns blob data and sets Content-Type header", async () => {
    const result = await callHandler(getHandler, buildEvent());

    expect(result).toBeInstanceOf(Uint8Array);
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Type",
      "image/jpeg",
    );
  });

  it("sets Cache-Control to immutable", async () => {
    await callHandler(getHandler, buildEvent());

    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
  });

  it("sets X-Content-Type-Options: nosniff to prevent MIME sniffing", async () => {
    await callHandler(getHandler, buildEvent());

    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "X-Content-Type-Options",
      "nosniff",
    );
  });

  it("throws 404 when the database row does not exist", async () => {
    mockDbSelectLimit.mockResolvedValue([]);

    await expect(callHandler(getHandler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("throws 404 when the blob is missing from the store", async () => {
    mockGetMediaBlob.mockResolvedValue(null);

    await expect(callHandler(getHandler, buildEvent())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("throws 400 when the route param is missing", async () => {
    mockGetRouterParam.mockReturnValue(undefined);

    await expect(callHandler(getHandler, buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/media/[id]/thumbnail
// ---------------------------------------------------------------------------

describe("GET /api/media/[id]/thumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockReturnValue("media-123");
    mockDbSelectLimit.mockResolvedValue([
      { url: "user-1/media-123", contentType: "image/jpeg" },
    ]);
    mockGetMediaBlob.mockResolvedValue({
      data: new ArrayBuffer(8),
      contentType: "image/jpeg",
    });
  });

  it("looks up the blob under the derived thumbnail key and returns it", async () => {
    const result = await callHandler(thumbnailGetHandler, buildEvent());

    expect(mockGetMediaBlob).toHaveBeenCalledWith("user-1/media-123-thumb");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Type",
      "image/jpeg",
    );
  });

  it("throws 404 when the database row does not exist", async () => {
    mockDbSelectLimit.mockResolvedValue([]);

    await expect(
      callHandler(thumbnailGetHandler, buildEvent()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 404 when no thumbnail was generated for this media", async () => {
    mockGetMediaBlob.mockResolvedValue(null);

    await expect(
      callHandler(thumbnailGetHandler, buildEvent()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 400 when the route param is missing", async () => {
    mockGetRouterParam.mockReturnValue(undefined);

    await expect(
      callHandler(thumbnailGetHandler, buildEvent()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
