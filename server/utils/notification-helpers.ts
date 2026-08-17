import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { notifications, users, userPreferences } from "../db/schema";

export interface NotificationInput {
  userId: string;
  type: string;
  tone: string | null;
  body: string;
  // The user whose action triggered this notification (e.g. the follower for
  // a new_follower notification). Omit or pass null when there is no acting
  // user to attribute (or the actor should stay anonymous).
  actorId?: string | null;
}

/**
 * Inserts a notification row for the given user.
 *
 * Errors are swallowed and logged — a notification failure must never
 * surface to the caller or break the action that triggered it.
 */
export async function createNotification(
  input: NotificationInput,
): Promise<void> {
  try {
    const database = getDb();
    await database.insert(notifications).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      type: input.type,
      tone: input.tone,
      body: input.body,
      actorId: input.actorId ?? null,
    });
  } catch (error) {
    console.error(
      "[notification-helpers] createNotification failed",
      input,
      error,
    );
  }
}

export interface NotificationActor {
  id: string;
  displayName: string | null;
  handle: string | null;
}

export interface NotificationRow {
  id: string;
  type: string;
  tone: string | null;
  body: string;
  isRead: boolean;
  createdAt: Date;
  actor: NotificationActor | null;
}

type Database = ReturnType<typeof getDb>;

interface RawNotificationRow {
  id: string;
  type: string;
  tone: string | null;
  body: string;
  isRead: boolean;
  createdAt: Date;
  actorId: string | null;
  actorDisplayName: string | null;
  actorHandle: string | null;
  actorDeletedAt: Date | null;
}

/**
 * Resolves the acting-user reference on a notification row into a renderable
 * actor, or null when there is nothing to show. Null covers legacy rows
 * (actorId was never set), rows whose actor has since soft-deleted their
 * account, and rows whose actor has neither a display name nor a handle set
 * (nothing to render) — all fall back to the notification's own generic
 * body text.
 */
function resolveActor(row: RawNotificationRow): NotificationActor | null {
  if (!row.actorId || row.actorDeletedAt) {
    return null;
  }
  if (!row.actorDisplayName && !row.actorHandle) {
    return null;
  }
  return {
    id: row.actorId,
    displayName: row.actorDisplayName,
    handle: row.actorHandle,
  };
}

/**
 * Returns a page of the most recent notifications for a user, with the acting
 * user (if any) resolved via a left join so legacy and deleted-actor rows
 * still return cleanly rather than being dropped or throwing.
 *
 * `offset` defaults to 0 so callers that only want the first page can omit it.
 */
export async function fetchNotificationsForUser(
  database: Database,
  userId: string,
  limit: number,
  offset = 0,
): Promise<NotificationRow[]> {
  const rows = await database
    .select({
      id: notifications.id,
      type: notifications.type,
      tone: notifications.tone,
      body: notifications.body,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
      actorId: notifications.actorId,
      actorDisplayName: userPreferences.displayName,
      actorHandle: userPreferences.handle,
      actorDeletedAt: users.deletedAt,
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorId, users.id))
    // Deliberately NOT gated on userPreferences.publicProfile, unlike every
    // other cross-user disclosure of displayName/handle in this codebase
    // (discover-queries.ts, search-queries.ts). That gate answers "can a
    // stranger find this person on the explore/search page" — publicProfile
    // defaults to false and is plan-gated, so most accounts can't even enable
    // it. A follow is a different relationship: the follower already took a
    // direct, targeted action naming this specific recipient (the follows
    // row), not a passive stranger-discovery surface. Gating this on
    // publicProfile would make "who followed you" render as the generic
    // fallback for the majority of accounts, defeating the point of this
    // notification for most users.
    .leftJoin(
      userPreferences,
      eq(notifications.actorId, userPreferences.userId),
    )
    .where(eq(notifications.userId, userId))
    // `id` is a unique secondary sort key purely to break ties *within a
    // single query* when multiple notifications share a createdAt, so row
    // order is deterministic. It does not stabilise order across separate
    // paginated requests: a notification inserted between two page fetches
    // still shifts later rows, so the client walk dedupes by id (see
    // appendUnseen in useNotifications).
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    tone: row.tone,
    body: row.body,
    isRead: row.isRead,
    createdAt: row.createdAt,
    actor: resolveActor(row),
  }));
}
