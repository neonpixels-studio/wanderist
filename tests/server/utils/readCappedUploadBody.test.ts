/**
 * Unit tests for readCappedUploadBody, the shared body-size backstop used by
 * server/api/media/index.post.ts.
 *
 * It has to work against two different shapes of `event.node.req`:
 *  - a real, event-emitting Node stream (the local dev server)
 *  - a `ReadableStream` sitting on `.body` (this app's deployed Netlify
 *    preset, whose mock `IncomingMessage` never emits `data`/`end` at all)
 * so both paths get their own coverage below.
 */
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import type { H3Event } from "h3";

Object.assign(globalThis, {
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
});

const { readCappedUploadBody } =
  await import("../../../server/utils/readCappedUploadBody");

const MAX_BYTES = 10 * 1024 * 1024;

function buildNodeStreamEvent(req: PassThrough): H3Event {
  return { node: { req } } as unknown as H3Event;
}

function buildWebStreamEvent(body: ReadableStream<Uint8Array>): H3Event {
  return { node: { req: { body } } } as unknown as H3Event;
}

// Builds a `ReadableStream` that yields `chunkCount` chunks of `chunkSize`
// bytes, tracking how many were actually pulled so a test can assert the
// cap stopped consumption early rather than draining every chunk.
function buildCountingWebStream(
  chunkSize: number,
  chunkCount: number,
): { stream: ReadableStream<Uint8Array>; getChunksPulled: () => number } {
  let chunksPulled = 0;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunkCount) {
        controller.close();
        return;
      }
      index += 1;
      chunksPulled += 1;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
  return { stream, getChunksPulled: () => chunksPulled };
}

describe("readCappedUploadBody — Node stream path (local dev server)", () => {
  it("resolves with the full buffer on normal completion", async () => {
    const req = new PassThrough();
    req.write(Buffer.from("fake-image-data"));
    req.end();

    const result = await readCappedUploadBody(
      buildNodeStreamEvent(req),
      MAX_BYTES,
    );

    expect(result.toString()).toBe("fake-image-data");
  });

  it("resolves with an empty buffer for an empty body", async () => {
    const req = new PassThrough();
    req.end();

    const result = await readCappedUploadBody(
      buildNodeStreamEvent(req),
      MAX_BYTES,
    );

    expect(result.byteLength).toBe(0);
  });

  it("accepts an upload of exactly the byte cap", async () => {
    const req = new PassThrough();
    req.write(Buffer.alloc(MAX_BYTES));
    req.end();

    const result = await readCappedUploadBody(
      buildNodeStreamEvent(req),
      MAX_BYTES,
    );

    expect(result.byteLength).toBe(MAX_BYTES);
  });

  it("rejects with 413 and stops reading before the full body arrives when the cap is exceeded", async () => {
    const req = new PassThrough();
    const chunkSize = 1024 * 1024; // 1 MB
    const chunk = Buffer.alloc(chunkSize);
    const totalChunksAvailable = 50; // simulates a 50 MB upload against the 10 MB cap
    const maxExpectedChunksSent = MAX_BYTES / chunkSize + 1;

    const resultPromise = readCappedUploadBody(
      buildNodeStreamEvent(req),
      MAX_BYTES,
    );
    let aborted = false;
    resultPromise.catch(() => {
      aborted = true;
    });

    let chunksSent = 0;
    for (let index = 0; index < totalChunksAvailable; index += 1) {
      if (aborted) {
        break;
      }
      req.write(chunk);
      chunksSent += 1;
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (!aborted) {
      req.end();
    }

    await expect(resultPromise).rejects.toMatchObject({ statusCode: 413 });
    // Paused (not destroyed) so a real response can still be sent over the
    // same connection — see the comment on request.pause() in the source.
    expect(req.isPaused()).toBe(true);
    expect(chunksSent).toBeLessThanOrEqual(maxExpectedChunksSent);
  });

  it("propagates a stream error instead of hanging", async () => {
    const req = new PassThrough();

    const resultPromise = readCappedUploadBody(
      buildNodeStreamEvent(req),
      MAX_BYTES,
    );
    // Give the promise executor a tick to attach its listeners before the
    // error fires, mirroring how a real client's request would arrive well
    // after the handler starts reading.
    await new Promise((resolve) => setImmediate(resolve));
    req.destroy(new Error("socket hang up"));

    await expect(resultPromise).rejects.toThrow("socket hang up");
  });

  it("rejects with 400 when the connection closes before the upload completes", async () => {
    const req = new PassThrough();

    const resultPromise = readCappedUploadBody(
      buildNodeStreamEvent(req),
      MAX_BYTES,
    );
    await new Promise((resolve) => setImmediate(resolve));
    req.write(Buffer.from("partial"));
    req.destroy(); // closes without an error and without ending

    await expect(resultPromise).rejects.toMatchObject({ statusCode: 400 });
  });

  it("counts a non-Buffer chunk correctly instead of disabling the cap", async () => {
    const req = new PassThrough();
    // Simulate a stream in string mode: emit a string chunk directly rather
    // than relying on `setEncoding`, which real Node streams rarely use for
    // binary uploads but which the cap must not silently trust either way.
    const resultPromise = readCappedUploadBody(
      buildNodeStreamEvent(req),
      MAX_BYTES,
    );
    req.emit("data", "not-a-buffer");
    req.end();

    const result = await resultPromise;
    expect(result.toString()).toBe("not-a-buffer");
  });
});

describe("readCappedUploadBody — Web ReadableStream path (deployed Netlify preset)", () => {
  it("resolves with the full buffer on normal completion", async () => {
    const { stream } = buildCountingWebStream(5, 3); // 15 bytes total

    const result = await readCappedUploadBody(
      buildWebStreamEvent(stream),
      MAX_BYTES,
    );

    expect(result.byteLength).toBe(15);
  });

  it("accepts an upload of exactly the byte cap", async () => {
    const chunkSize = 1024 * 1024;
    const { stream } = buildCountingWebStream(chunkSize, MAX_BYTES / chunkSize);

    const result = await readCappedUploadBody(
      buildWebStreamEvent(stream),
      MAX_BYTES,
    );

    expect(result.byteLength).toBe(MAX_BYTES);
  });

  it("rejects with 413 and cancels the stream before pulling every chunk when the cap is exceeded", async () => {
    const chunkSize = 1024 * 1024; // 1 MB
    const totalChunksAvailable = 50; // simulates a 50 MB upload against the 10 MB cap
    const { stream, getChunksPulled } = buildCountingWebStream(
      chunkSize,
      totalChunksAvailable,
    );

    await expect(
      readCappedUploadBody(buildWebStreamEvent(stream), MAX_BYTES),
    ).rejects.toMatchObject({ statusCode: 413 });

    // Proves the handler cancelled well before the full (simulated) 50 MB
    // upload was pulled through — it never buffered anywhere close to it.
    expect(getChunksPulled()).toBeLessThan(totalChunksAvailable);
  });
});
