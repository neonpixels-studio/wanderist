/**
 * Read/visibility queries for guides.
 *
 * All functions accept a pre-built database instance so they can be tested in
 * isolation without mocking module-level singletons, matching discover-queries.
 */
import { and, eq } from "drizzle-orm";
import { guides, users, userPreferences, VISIBILITY } from "../db/schema";
import { discoverableAuthorCondition, type Database } from "./discover-queries";

type Guide = typeof guides.$inferSelect;

// One message for both 404 branches (missing guide / not allowed to read it) so
// a non-owner can't tell a private or hidden guide apart from one that doesn't
// exist, and the two throws can't drift.
const GUIDE_NOT_FOUND = "Guide not found";

async function fetchGuideRow(
  database: Database,
  id: string,
): Promise<Guide | undefined> {
  const rows = await database
    .select()
    .from(guides)
    .where(eq(guides.id, id))
    .limit(1);

  return rows[0];
}

/**
 * True when a guide is readable by someone who is NOT its owner. Explore is the
 * only place a non-owner obtains a guide id, so a direct read is allowed only
 * for a guide that would surface on explore: public visibility plus a
 * discoverable author (see discoverableAuthorCondition). This keeps a guide
 * from staying readable by id after its author deletes their account, goes
 * private, or opts out of explore.
 */
async function isReadableByNonOwner(
  database: Database,
  guide: Guide,
): Promise<boolean> {
  if (guide.visibility !== VISIBILITY.PUBLIC) {
    return false;
  }

  const rows = await database
    .select({ userId: users.id })
    .from(users)
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(and(eq(users.id, guide.userId), discoverableAuthorCondition()))
    .limit(1);

  return rows.length > 0;
}

/**
 * Loads a single guide by id and enforces read visibility: the owner reads
 * their guide at any visibility; a non-owner reads it only when it would show
 * on explore (see isReadableByNonOwner). Anything else throws 404 (not 403) so
 * the endpoint never leaks that a guide with that id exists — mirroring how
 * loadOwnedOrThrow hides other users' rows behind a 404.
 *
 * `userId` is null for an anonymous visitor following a shared public-guide
 * link. An anonymous reader is simply a non-owner (a null id never equals a
 * guide's owner), so they clear the same public-and-discoverable bar and see
 * nothing a signed-in non-owner couldn't.
 */
export async function loadReadableGuide(
  database: Database,
  id: string,
  userId: string | null,
): Promise<Guide> {
  const guide = await fetchGuideRow(database, id);

  if (!guide) {
    throw createError({ statusCode: 404, statusMessage: GUIDE_NOT_FOUND });
  }

  if (guide.userId === userId) {
    return guide;
  }

  const readable = await isReadableByNonOwner(database, guide);

  if (!readable) {
    throw createError({ statusCode: 404, statusMessage: GUIDE_NOT_FOUND });
  }

  return guide;
}

export interface GuideWithAuthor extends Guide {
  ownerDisplayName: string | null;
  ownerHandle: string | null;
}

/**
 * Looks up the byline fields for a guide's author. Called only after the
 * caller already knows the guide is readable (see loadReadableGuideWithAuthor)
 * — by that point the author is either the requester themselves (always safe
 * to show their own name) or has already cleared discoverableAuthorCondition
 * (public, live, entitled, on explore), so this never needs to repeat that
 * gate. A missing preferences row (unexpected, since every user gets one on
 * signup) degrades to nulls rather than throwing, so a byline glitch can't
 * take down the guide read path.
 */
async function fetchGuideAuthor(
  database: Database,
  userId: string,
): Promise<{ displayName: string | null; handle: string | null }> {
  const rows = await database
    .select({
      displayName: userPreferences.displayName,
      handle: userPreferences.handle,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return rows[0] ?? { displayName: null, handle: null };
}

/**
 * Same visibility rule as loadReadableGuide, with the author's byline fields
 * (displayName/handle from user_preferences) merged in for display — the
 * detail page and any card showing a public guide need to say who wrote it
 * (see the guides/[id] read-only page).
 */
export async function loadReadableGuideWithAuthor(
  database: Database,
  id: string,
  userId: string | null,
): Promise<GuideWithAuthor> {
  const guide = await loadReadableGuide(database, id, userId);
  const author = await fetchGuideAuthor(database, guide.userId);

  return {
    ...guide,
    ownerDisplayName: author.displayName,
    ownerHandle: author.handle,
  };
}
