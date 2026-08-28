import { requireRouterParam } from "../../../utils/db-helpers";
import { requireUser } from "../../../utils/auth";
import { getDb } from "../../../db/index";
import { entries } from "../../../db/schema";
import {
  ENTRY_LIKEABLE,
  likeContent,
  loadLikeableOrThrow,
} from "../../../utils/like-helpers";
import { notifyAuthorOfLike } from "../../../utils/notification-helpers";

type EntryRow = typeof entries.$inferSelect;

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");
  const userId = requireUser(event);
  const database = getDb();

  const entry = await loadLikeableOrThrow<EntryRow>(
    database,
    ENTRY_LIKEABLE,
    id,
    userId,
  );

  const { content, created } = await likeContent<EntryRow>(
    database,
    ENTRY_LIKEABLE,
    id,
    userId,
  );

  if (created) {
    await notifyAuthorOfLike({
      authorId: entry.userId,
      likerId: userId,
      contentType: "entry",
    });
  }

  return { id, likeCount: content.likeCount, likedByCurrentUser: true };
});
