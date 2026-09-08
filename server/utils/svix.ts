import { Webhook } from "svix";

// Svix header names used for webhook signature verification.
export const SVIX_ID_HEADER = "svix-id";
export const SVIX_TIMESTAMP_HEADER = "svix-timestamp";
export const SVIX_SIGNATURE_HEADER = "svix-signature";

export interface SvixHeaders {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
}

/**
 * Verifies a Svix webhook signature and returns the parsed payload.
 * Throws if the signature is invalid or headers are missing.
 * Isolated here so callers can stub this seam in tests without network access.
 *
 * svix 2.2.0 changed `Webhook.verify()` to always return `undefined` (it now
 * calls the underlying standardwebhooks verify with `jsonParse: false` and
 * discards the result) -- it only performs the signature/timestamp check and
 * throws on failure. We parse `rawBody` ourselves once verification succeeds.
 */
export function verifySvixSignature<T = unknown>(
  rawBody: string,
  svixHeaders: SvixHeaders,
  secret: string,
): T {
  const webhook = new Webhook(secret);
  webhook.verify(rawBody, svixHeaders);
  return JSON.parse(rawBody) as T;
}
