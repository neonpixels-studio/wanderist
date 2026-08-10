import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { users } from "../db/schema";
import { getClerkClient } from "./clerk";

export function requireUser(event: H3Event): string {
  const userId = event.context.userId;
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return userId;
}

/**
 * Returns the request's authenticated user id, or null when the request is
 * anonymous. Use on read routes that serve public resources to anonymous
 * visitors (see server/middleware/auth.ts optional-auth paths); the route's own
 * visibility rule decides what a null (non-owner) reader may see.
 */
export function optionalUser(event: H3Event): string | null {
  return event.context.userId ?? null;
}

/**
 * True when new-user provisioning is turned off (invite-only mode).
 * Read via runtimeConfig (not process.env) so the value bakes into the server
 * bundle at build time and survives into the deployed Netlify function.
 * Clerk still owns account creation; this only governs whether an account gets
 * a usable app-DB row.
 */
export function signupsDisabled(): boolean {
  return useRuntimeConfig().disableSignups === "true";
}

/**
 * Ensures a users row exists for the current request's Clerk user.
 * Call this at the top of any API handler that inserts rows referencing users.id,
 * so the first request after signup never fails before the webhook lands.
 */
export async function ensureUser(event: H3Event): Promise<string> {
  const userId = requireUser(event);

  const db = getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing.length > 0) {
    return userId;
  }

  // No row yet means this is a first-time provision. When sign-ups are disabled
  // refuse it rather than creating the user, so invite-only mode holds even for
  // an account that made it through Clerk.
  if (signupsDisabled()) {
    throw createError({
      statusCode: 403,
      statusMessage: "Sign-ups are currently disabled",
    });
  }

  const clerkClient = getClerkClient();

  let clerkUser: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try {
    clerkUser = await clerkClient.users.getUser(userId);
  } catch (error) {
    console.error(`ensureUser: failed to fetch Clerk user ${userId}`, error);
    throw createError({
      statusCode: 503,
      statusMessage: "Could not verify user identity; please try again",
    });
  }

  const primaryEmail = clerkUser.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId,
  );

  if (!primaryEmail) {
    throw createError({
      statusCode: 422,
      statusMessage: "Clerk user has no primary email address",
    });
  }

  await db
    .insert(users)
    .values({ id: userId, email: primaryEmail.emailAddress })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: primaryEmail.emailAddress },
    });

  return userId;
}
