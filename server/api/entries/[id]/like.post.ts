import { requireRouterParam } from "../../../utils/db-helpers";
import { requireUser } from "../../../utils/auth";
import { getDb } from "../../../db/index";
import { entries } from "../../../db/schema";
import {
  ENTRY_LIKEABLE,
  likeContent,
  loadLikeableOrThrow,
} from "../../../utils/like-helpers";

type EntryRow = typeof entries.$inferSelect;

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");
  const userId = requireUser(event);
  const database = getDb();

  await loadLikeableOrThrow(database, ENTRY_LIKEABLE, id, userId);

  const updated = await likeContent<EntryRow>(
    database,
    ENTRY_LIKEABLE,
    id,
    userId,
  );

  return { id, likeCount: updated.likeCount, likedByCurrentUser: true };
});
