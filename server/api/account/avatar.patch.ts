import { requireUser } from "../../utils/auth";
import {
  clerkSetProfileImage,
  clerkRemoveProfileImage,
} from "../../utils/clerkAccount";
import {
  createFileTooLargeError,
  readCappedUploadBody,
} from "../../utils/readCappedUploadBody";

// 4 MB expressed in bytes — matches the UI copy "up to 4MB". Exported so
// tests assert against this value directly instead of keeping their own
// copy that could silently drift from it.
export const MAX_AVATAR_SIZE_BYTES = 4 * 1024 * 1024;

const ALLOWED_AVATAR_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

function assertAvatarContentTypeAllowed(contentType: string): void {
  if (!ALLOWED_AVATAR_CONTENT_TYPES.has(contentType)) {
    throw createError({
      statusCode: 415,
      statusMessage: `Unsupported media type. Allowed: ${[...ALLOWED_AVATAR_CONTENT_TYPES].join(", ")}`,
    });
  }
}

// Reject early on Content-Length before reading the body at all. This is
// only a fast path for honest clients — the real backstop against a
// malicious client that omits or understates Content-Length is the byte cap
// `readCappedUploadBody` enforces while the body streams in.
function assertAvatarSizeAllowed(byteLength: number): void {
  if (byteLength > MAX_AVATAR_SIZE_BYTES) {
    throw createFileTooLargeError(MAX_AVATAR_SIZE_BYTES);
  }
}

export default defineEventHandler(async (event) => {
  const userId = requireUser(event);

  // A DELETE action is signalled via ?action=remove on PATCH to avoid needing a
  // separate DELETE route (Nitro only allows one handler per method/path combo).
  const query = getQuery(event);
  if (query.action === "remove") {
    await clerkRemoveProfileImage(userId);
    return { ok: true };
  }

  const contentType = (getHeader(event, "content-type") ?? "")
    .split(";")[0]
    .trim();
  assertAvatarContentTypeAllowed(contentType);

  const declaredLength = Number(getHeader(event, "content-length") ?? 0);
  assertAvatarSizeAllowed(declaredLength);

  const rawBody = await readCappedUploadBody(event, MAX_AVATAR_SIZE_BYTES);
  if (!rawBody || rawBody.byteLength === 0) {
    throw createError({ statusCode: 400, statusMessage: "Empty request body" });
  }

  const fileBlob = new Blob([rawBody], { type: contentType });
  const imageUrl = await clerkSetProfileImage(userId, fileBlob);

  return { imageUrl };
});
