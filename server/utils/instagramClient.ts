/**
 * Isolated Instagram Graph API client.
 *
 * All Instagram API calls go through this module so handlers stay thin and
 * tests can mock the network without touching the real endpoint.
 *
 * NOTE: Instagram's Basic Display API was deprecated in December 2024.
 * This implementation targets the Instagram Graph API, which requires a
 * Facebook App connected to a Business or Creator Instagram account. Users
 * must grant the `instagram_basic` and `instagram_manage_media` permissions
 * during OAuth.
 */

export const INSTAGRAM_GRAPH_BASE_URL = "https://graph.instagram.com";
export const INSTAGRAM_OAUTH_AUTHORIZE_URL =
  "https://api.instagram.com/oauth/authorize";
export const INSTAGRAM_OAUTH_TOKEN_URL =
  "https://api.instagram.com/oauth/access_token";
export const INSTAGRAM_LONG_LIVED_TOKEN_URL =
  "https://graph.instagram.com/access_token";
export const INSTAGRAM_REFRESH_TOKEN_URL =
  "https://graph.instagram.com/refresh_access_token";

export const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_manage_media",
].join(",");

export const INSTAGRAM_MEDIA_FIELDS =
  "id,caption,media_type,timestamp,permalink,media_url,location";

export const INSTAGRAM_MEDIA_LIMIT = 50;

// Upper bound on how many /me/media pages a single import follows via
// paging.next. Caps a run at INSTAGRAM_MAX_MEDIA_PAGES * INSTAGRAM_MEDIA_LIMIT
// items so a very large account can't spin the handler indefinitely.
export const INSTAGRAM_MAX_MEDIA_PAGES = 10;

// Upper bound on how many *new* photos a single import run downloads,
// processes, and commits. Each item does a CDN image fetch, a sharp probe +
// thumbnail, a DB transaction, and two blob writes — on the order of ~1s each,
// so an unbounded run over a first-time account's ~500 geotagged items overruns
// the Netlify function timeout and commits partial work.
//
// Budget: this repo sets no maxDuration, so functions run on Netlify's default
// synchronous ceiling (10s). The page walk (fetchInstagramMedia, up to
// INSTAGRAM_MAX_MEDIA_PAGES requests) spends a few seconds before any import,
// leaving room for a single-digit batch. 8 × ~1s keeps the worst case inside
// the 10s ceiling with headroom. The remaining items resume on the next run
// (already-imported items are skipped via the idempotent media.source_id set,
// so progress persists across runs without extra state).
//
// This is a secondary ceiling on top of the wall-time budget below: raise it
// only alongside a raised function timeout, and prefer a background/scheduled
// function over a large cap for accounts with hundreds of geotagged photos.
export const INSTAGRAM_IMPORT_MAX_ITEMS_PER_RUN = 8;

// Wall-time budget for the whole import invocation (anchored at handler entry).
// A count cap alone can't bound duration — per-item cost varies with image
// size, sharp work, and blob-store latency — so the loop stops before starting
// a new item once this budget is spent, deferring the rest to the next run.
//
// The true worst case is this budget plus the one item already in flight when
// the check trips: 7000ms + a ~1-3s item ≈ 8-10s, which sits under Netlify's
// default 10s synchronous ceiling. Raise the budget only alongside a raised
// timeout, and keep the gap to the ceiling ≥ the slowest expected item.
//
// Caveat: the preceding page walk (fetchInstagramMedia, up to
// INSTAGRAM_MAX_MEDIA_PAGES requests) is counted against this budget but not
// itself interrupted by it, so a pathologically slow walk could still approach
// the ceiling before any import. Bounding the walk by the same deadline is a
// worthwhile follow-up.
export const INSTAGRAM_IMPORT_TIME_BUDGET_MS = 7000;

// Only image types can carry location metadata.
export const INSTAGRAM_GEOTAGGED_MEDIA_TYPES = new Set([
  "IMAGE",
  "CAROUSEL_ALBUM",
]);

export interface InstagramTokenResponse {
  access_token: string;
  token_type: string;
}

export interface InstagramLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  // Optional: Instagram normally returns this for long-lived/refresh
  // responses, but the connect and refresh paths both guard against its
  // absence rather than storing an Invalid Date, so the type reflects that.
  expires_in?: number;
}

// Meta's OAuthException error `type`, and the `code` it uses whenever an access
// token is expired, revoked, or otherwise invalid. Meta returns a 400 for a
// broad range of conditions, but only an OAuthException with this code (its
// error_subcode narrows the exact cause: 460 password change, 463 expiry, 467
// invalid, etc.) genuinely means the token is dead and the account must
// reconnect. Any other 400 is transient and must not disconnect the account.
export const META_OAUTH_EXCEPTION_TYPE = "OAuthException";
export const META_TOKEN_REVOKED_CODE = 190;

/**
 * The relevant fields Meta returns inside an error response body's `error`
 * object. Each is optional because a non-Meta 400 (a gateway, an edge cache, a
 * plain-text body) carries none of them — parseMetaError yields undefined in
 * that case so the caller treats it as transient rather than a revocation.
 */
export interface MetaErrorDetail {
  type?: string;
  code?: number;
  subcode?: number;
}

/**
 * Parses Meta's error envelope (`{ error: { message, type, code,
 * error_subcode } }`) out of a response body. Defensive: a body that is not
 * JSON, is not an object, or lacks a well-formed `error` object yields
 * undefined so callers classify it as transient rather than a revocation.
 */
export function parseMetaError(body: string): MetaErrorDetail | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const detail = error as {
    type?: unknown;
    code?: unknown;
    error_subcode?: unknown;
  };
  const parsedDetail: MetaErrorDetail = {
    type: typeof detail.type === "string" ? detail.type : undefined,
    code: typeof detail.code === "number" ? detail.code : undefined,
    subcode:
      typeof detail.error_subcode === "number"
        ? detail.error_subcode
        : undefined,
  };
  // An `error` object carrying none of the fields we understand (all wrong
  // types, or an empty/array `error`) is not a usable Meta envelope — return
  // undefined so callers treat it as transient rather than "Meta said something".
  if (
    parsedDetail.type === undefined &&
    parsedDetail.code === undefined &&
    parsedDetail.subcode === undefined
  ) {
    return undefined;
  }
  return parsedDetail;
}

/**
 * Error carrying the HTTP status of a failed Instagram API call plus the parsed
 * Meta error detail (code/subcode/type) when the body carried one, so callers
 * can distinguish a genuine token revocation (OAuthException code 190 — user
 * must reconnect) from a transient failure (an ambiguous 400, 429, 5xx — retry
 * later) rather than disconnecting on any 400.
 */
export class InstagramApiError extends Error {
  readonly status: number;
  readonly metaError?: MetaErrorDetail;

  constructor(message: string, status: number, metaError?: MetaErrorDetail) {
    super(message);
    this.name = "InstagramApiError";
    this.status = status;
    this.metaError = metaError;
  }
}

export interface InstagramUserResponse {
  id: string;
  username?: string;
}

export interface InstagramMediaLocation {
  name: string;
  // Coordinates are required — items without both are excluded by
  // filterGeotaggedMedia before import.
  latitude: number;
  longitude: number;
}

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type: string;
  media_url: string;
  timestamp: string;
  permalink: string;
  location?: InstagramMediaLocation;
}

export interface InstagramMediaResponse {
  data: InstagramMediaItem[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
}

/**
 * Builds the Instagram OAuth authorization URL to redirect the user to.
 */
export function buildInstagramAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: INSTAGRAM_SCOPES,
    response_type: "code",
    state: params.state,
  });
  return `${INSTAGRAM_OAUTH_AUTHORIZE_URL}?${query.toString()}`;
}

/**
 * Exchanges an authorization code for a short-lived access token.
 */
export async function exchangeInstagramCode(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<InstagramTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code: params.code,
  });

  const response = await fetch(INSTAGRAM_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Instagram token exchange failed (${response.status}): ${text}`,
    );
  }

  return response.json() as Promise<InstagramTokenResponse>;
}

/**
 * Exchanges a short-lived token for a long-lived token (60-day expiry).
 */
export async function exchangeForLongLivedToken(params: {
  clientSecret: string;
  shortLivedToken: string;
}): Promise<InstagramLongLivedTokenResponse> {
  const query = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: params.clientSecret,
    access_token: params.shortLivedToken,
  });

  const response = await fetch(
    `${INSTAGRAM_LONG_LIVED_TOKEN_URL}?${query.toString()}`,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Instagram long-lived token exchange failed (${response.status}): ${text}`,
    );
  }

  return response.json() as Promise<InstagramLongLivedTokenResponse>;
}

/**
 * Refreshes a long-lived token, returning a fresh 60-day token. Instagram
 * requires the current token to be valid and at least 24 hours old; a token
 * that has already expired cannot be refreshed and yields a non-2xx response.
 */
export async function refreshLongLivedToken(params: {
  accessToken: string;
}): Promise<InstagramLongLivedTokenResponse> {
  const query = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: params.accessToken,
  });

  const response = await fetch(
    `${INSTAGRAM_REFRESH_TOKEN_URL}?${query.toString()}`,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new InstagramApiError(
      `Instagram token refresh failed (${response.status}): ${text}`,
      response.status,
      parseMetaError(text),
    );
  }

  return response.json() as Promise<InstagramLongLivedTokenResponse>;
}

/**
 * Fetches the authenticated Instagram user's profile (id + username).
 */
export async function fetchInstagramUser(
  accessToken: string,
): Promise<InstagramUserResponse> {
  const query = new URLSearchParams({
    fields: "id,username",
    access_token: accessToken,
  });

  const response = await fetch(
    `${INSTAGRAM_GRAPH_BASE_URL}/me?${query.toString()}`,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Instagram user fetch failed (${response.status}): ${text}`,
    );
  }

  return response.json() as Promise<InstagramUserResponse>;
}

/**
 * Fetches a single /me/media page from a fully-formed URL. Instagram's
 * paging.next already carries the fields, limit, cursor, and access_token, so
 * this seam is reused verbatim for both the first request and every follow-up.
 */
async function fetchInstagramMediaPage(
  url: string,
): Promise<InstagramMediaResponse> {
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Instagram media fetch failed (${response.status}): ${text}`,
    );
  }

  return response.json() as Promise<InstagramMediaResponse>;
}

/**
 * Resolves the next page URL to follow, or undefined to stop. Only cursors
 * that stay on the Instagram Graph host are followed: a `next` pointing
 * elsewhere would be a server-side request forgery seam and never occurs in a
 * legitimate response, so it's rejected loudly rather than fetched.
 */
function resolveNextPageUrl(
  paging: InstagramMediaResponse["paging"],
): string | undefined {
  const next = paging?.next;
  // Catches undefined, null, and "" — a real API sends an explicit null when
  // there's no further page, which new URL() would otherwise choke on.
  if (!next) {
    return undefined;
  }
  const graphOrigin = new URL(INSTAGRAM_GRAPH_BASE_URL).origin;
  if (new URL(next).origin === graphOrigin) {
    return next;
  }
  console.warn(
    `fetchInstagramMedia: ignoring off-host paging.next (${new URL(next).origin})`,
  );
  return undefined;
}

/**
 * Deduplicates media items by id, keeping one entry per id. Cursor paging is
 * not a consistent snapshot, so a media item can appear on two pages if the
 * account changes mid-walk; without this the import's unique (user, source,
 * source_id) index would reject the second copy as a spurious error.
 */
function dedupeById(items: InstagramMediaItem[]): InstagramMediaItem[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

/**
 * Fetches the authenticated user's media, following paging.next up to
 * INSTAGRAM_MAX_MEDIA_PAGES so imports reach geotagged photos older than the
 * most recent batch. Returns one response whose `data` concatenates every
 * fetched page, deduplicated by id.
 *
 * A failure on the first page throws (bad token / no data is genuinely fatal);
 * a failure on a later page (e.g. a rate-limit 429 deep in the walk) stops the
 * walk and returns the pages already gathered rather than voiding them, logging
 * why. `paging` is the last page seen and is not a reliable truncation signal.
 */
export async function fetchInstagramMedia(
  accessToken: string,
): Promise<InstagramMediaResponse> {
  const query = new URLSearchParams({
    fields: INSTAGRAM_MEDIA_FIELDS,
    limit: String(INSTAGRAM_MEDIA_LIMIT),
    access_token: accessToken,
  });

  const aggregatedData: InstagramMediaItem[] = [];
  let lastPaging: InstagramMediaResponse["paging"];
  let nextUrl: string | undefined =
    `${INSTAGRAM_GRAPH_BASE_URL}/me/media?${query.toString()}`;
  let page = 0;

  for (; nextUrl !== undefined && page < INSTAGRAM_MAX_MEDIA_PAGES; page += 1) {
    let pageResponse: InstagramMediaResponse;
    try {
      pageResponse = await fetchInstagramMediaPage(nextUrl);
    } catch (error) {
      if (page === 0) {
        throw error;
      }
      console.warn(
        `fetchInstagramMedia: stopping after page ${page}: ${String(error)}`,
      );
      break;
    }
    // Defensive against a malformed page body: the documented contract always
    // includes `data`, but an error envelope or edge-cached body may omit it.
    aggregatedData.push(...(pageResponse.data ?? []));
    lastPaging = pageResponse.paging;
    nextUrl = resolveNextPageUrl(pageResponse.paging);
  }

  if (nextUrl !== undefined && page >= INSTAGRAM_MAX_MEDIA_PAGES) {
    console.warn(
      `fetchInstagramMedia: hit ${INSTAGRAM_MAX_MEDIA_PAGES}-page bound; import truncated`,
    );
  }

  return { data: dedupeById(aggregatedData), paging: lastPaging };
}

/**
 * Fetches the raw image bytes from an Instagram CDN URL.
 * Isolated here so the import handler can be tested without network access.
 */
export async function fetchInstagramImage(mediaUrl: string): Promise<Buffer> {
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Instagram image (${response.status}): ${mediaUrl}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Filters a list of media items to only those with complete geotag data:
 * a non-empty location name, both latitude and longitude present as numbers.
 */
export function filterGeotaggedMedia(
  items: InstagramMediaItem[],
): InstagramMediaItem[] {
  return items.filter(
    (item) =>
      INSTAGRAM_GEOTAGGED_MEDIA_TYPES.has(item.media_type) &&
      item.location !== undefined &&
      typeof item.location.name === "string" &&
      item.location.name.length > 0 &&
      typeof item.location.latitude === "number" &&
      typeof item.location.longitude === "number",
  );
}
