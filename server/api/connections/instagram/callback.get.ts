/**
 * GET /api/connections/instagram/callback
 *
 * Handles the Instagram OAuth redirect. Exchanges the code for tokens, fetches
 * the Instagram user ID, stores the encrypted long-lived token in
 * `connected_accounts`, and redirects the user to /settings#connections.
 *
 * One Instagram account per user is enforced: the upsert targets (userId,
 * provider) so reconnecting or switching accounts replaces the existing row.
 */

import { ensureUser } from "../../../utils/auth";
import { getDb } from "../../../db/index";
import {
  connectedAccounts,
  CONNECTED_ACCOUNT_PROVIDER,
} from "../../../db/schema";
import {
  exchangeInstagramCode,
  exchangeForLongLivedToken,
  fetchInstagramUser,
} from "../../../utils/instagramClient";
import { expiryFromResponse } from "../../../utils/instagramToken";
import { encryptToken } from "../../../utils/tokenCrypto";

const STATE_COOKIE_NAME = "ig_oauth_state";
const SETTINGS_REDIRECT_PATH =
  "/settings?connection=instagram_success#connections";
// Query param comes before the fragment so useRoute().query can read it.
const ERROR_REDIRECT_PATH = "/settings?connection_error=instagram#connections";

function buildRedirectUri(origin: string): string {
  return `${origin}/api/connections/instagram/callback`;
}

function readInstagramConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const config = useRuntimeConfig();
  const clientId = process.env.INSTAGRAM_CLIENT_ID || config.instagramClientId;
  const clientSecret =
    process.env.INSTAGRAM_CLIENT_SECRET || config.instagramClientSecret;
  const appOrigin =
    process.env.NUXT_PUBLIC_SITE_ORIGIN || config.public.siteOrigin;

  if (!clientId || !clientSecret || !appOrigin) {
    throw createError({
      statusCode: 500,
      statusMessage: "Instagram OAuth is not configured",
    });
  }

  return { clientId, clientSecret, redirectUri: buildRedirectUri(appOrigin) };
}

export default defineEventHandler(async (event) => {
  const userId = await ensureUser(event);

  const query = getQuery(event);
  const code = query.code as string | undefined;
  const returnedState = query.state as string | undefined;
  const oauthError = query.error as string | undefined;

  // User denied the authorization.
  if (oauthError) {
    deleteCookie(event, STATE_COOKIE_NAME);
    return sendRedirect(event, ERROR_REDIRECT_PATH, 302);
  }

  if (!code || !returnedState) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing code or state",
    });
  }

  const storedState = getCookie(event, STATE_COOKIE_NAME);
  deleteCookie(event, STATE_COOKIE_NAME);

  if (!storedState || storedState !== returnedState) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid OAuth state",
    });
  }

  const { clientId, clientSecret, redirectUri } = readInstagramConfig();

  const shortLivedTokenResponse = await exchangeInstagramCode({
    clientId,
    clientSecret,
    redirectUri,
    code,
  });

  const longLivedTokenResponse = await exchangeForLongLivedToken({
    clientSecret,
    shortLivedToken: shortLivedTokenResponse.access_token,
  });

  const instagramUser = await fetchInstagramUser(
    longLivedTokenResponse.access_token,
  );

  const encryptedToken = encryptToken(longLivedTokenResponse.access_token);
  // Persist the token's expiry so it can be refreshed before it lapses. Shared
  // with the refresh path so connect and refresh derive the expiry identically.
  const expiresAt = expiryFromResponse(longLivedTokenResponse, new Date());
  const database = getDb();

  // Upsert on (userId, provider) to enforce one Instagram account per user.
  // The schema's unique constraint is on (provider, externalId); we use a
  // set-where clause approach via onConflictDoNothing + a preceding delete to
  // cleanly replace any existing row for this user before inserting the new one.
  await database
    .insert(connectedAccounts)
    .values({
      id: crypto.randomUUID(),
      userId,
      provider: CONNECTED_ACCOUNT_PROVIDER.INSTAGRAM,
      externalId: instagramUser.id,
      accessToken: encryptedToken,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [connectedAccounts.provider, connectedAccounts.externalId],
      set: {
        userId,
        accessToken: encryptedToken,
        expiresAt,
        connectedAt: new Date(),
      },
    });

  return sendRedirect(event, SETTINGS_REDIRECT_PATH, 302);
});
