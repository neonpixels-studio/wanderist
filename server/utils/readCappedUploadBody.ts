import type { H3Event } from "h3";

// Single source of the 413 error so every caller (the route's early
// Content-Length gate and both streaming paths below) reports the exact
// same, correctly-rounded message instead of drifting independently.
export function createFileTooLargeError(maxBytes: number): Error {
  return createError({
    statusCode: 413,
    statusMessage: `File too large. Maximum size is ${maxBytes / (1024 * 1024)} MB`,
  });
}

function isWebReadableStream(
  value: unknown,
): value is ReadableStream<Uint8Array> {
  return typeof (value as { getReader?: unknown })?.getReader === "function";
}

// Drains a Web Streams `ReadableStream`, aborting as soon as more than
// `maxBytes` have arrived.
async function readCappedWebStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        // Signals upstream that we're no longer interested in the rest of
        // the body — the Fetch API equivalent of pausing a Node stream.
        await reader.cancel();
        throw createFileTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

// Reads the request body directly off the underlying Node stream, aborting
// as soon as more than `maxBytes` have arrived.
function readCappedNodeStream(
  event: H3Event,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = event.node.req;
    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    function cleanup(): void {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("close", onClose);
      request.off("error", onError);
      // Once settled we no longer want stream errors to reject anything,
      // but Node throws on an `error` event left with zero listeners (e.g.
      // a connection reset arriving after we've already paused reading), so
      // leave a no-op in `onError`'s place rather than fully detaching.
      request.on("error", () => {});
    }

    function onData(chunk: Buffer | string): void {
      // `chunk` is a Buffer for every caller in this codebase (nothing sets
      // an encoding on the request), but guard anyway: a string chunk would
      // make `byteLength` undefined and silently disable the cap below.
      const bufferedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += bufferedChunk.byteLength;
      if (receivedBytes > maxBytes) {
        cleanup();
        // Stop reading further bytes without destroying the socket — the
        // request and response can share a connection (e.g. local dev's raw
        // Node HTTP server), and destroying the request can prevent the 413
        // response below from ever reaching the client. Pausing still bounds
        // our own memory: the client's remaining bytes sit in the OS/TCP
        // buffer, not in this process, and normal TCP backpressure stalls
        // the sender once that buffer fills.
        request.pause();
        reject(createFileTooLargeError(maxBytes));
        return;
      }
      chunks.push(bufferedChunk);
    }

    function onEnd(): void {
      cleanup();
      resolve(Buffer.concat(chunks));
    }

    function onError(error: Error): void {
      cleanup();
      reject(error);
    }

    // A client that disconnects mid-upload emits `close` without `data`
    // finishing, and (unlike a normal parse failure) may never emit `error`
    // either — without this, the promise would hang forever on an abandoned
    // connection. `onEnd` already ran `cleanup()` on the happy path, so this
    // is a no-op there.
    function onClose(): void {
      cleanup();
      reject(
        createError({
          statusCode: 400,
          statusMessage: "Upload connection closed before completion",
        }),
      );
    }

    request
      .on("data", onData)
      .on("end", onEnd)
      .on("error", onError)
      .on("close", onClose);
  });
}

// Reads an upload body with a hard byte cap, so a client that omits or
// understates Content-Length can't force unbounded buffering into memory.
//
// Which stream shape `event.node.req` actually is depends on the Nitro
// preset the request came through: the local Node dev server gives a real,
// event-emitting `http.IncomingMessage`, but this app's deployed Netlify
// preset adapts an underlying Web `Request` and exposes the body as a
// `ReadableStream` on `event.node.req.body` instead — the mock
// `IncomingMessage` behind it (`node-mock-http`) never emits `data`/`end` at
// all. h3's own `readRawBody()` falls back to that same `body` property for
// the same reason; without branching on it here, every upload would hang
// forever in production while working fine in local dev and tests.
export function readCappedUploadBody(
  event: H3Event,
  maxBytes: number,
): Promise<Buffer> {
  const requestBody = (event.node.req as unknown as { body?: unknown }).body;
  if (isWebReadableStream(requestBody)) {
    return readCappedWebStream(requestBody, maxBytes);
  }
  return readCappedNodeStream(event, maxBytes);
}
