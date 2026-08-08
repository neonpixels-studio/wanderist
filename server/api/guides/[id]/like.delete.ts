import { requireRouterParam } from "../../../utils/db-helpers";
import { requireUser } from "../../../utils/auth";
import { getDb } from "../../../db/index";
import { guides } from "../../../db/schema";
import {
  GUIDE_LIKEABLE,
  loadLikeableOrThrow,
  unlikeContent,
} from "../../../utils/like-helpers";

type GuideRow = typeof guides.$inferSelect;

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");
  const userId = requireUser(event);
  const database = getDb();

  await loadLikeableOrThrow(database, GUIDE_LIKEABLE, id, userId);

  const updated = await unlikeContent<GuideRow>(
    database,
    GUIDE_LIKEABLE,
    id,
    userId,
  );

  return { id, likeCount: updated.likeCount, likedByCurrentUser: false };
});
