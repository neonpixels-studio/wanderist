import { requireRouterParam } from "../../../utils/db-helpers";
import { requireUser } from "../../../utils/auth";
import { getDb } from "../../../db/index";
import { guides } from "../../../db/schema";
import { loadReadableGuide } from "../../../utils/guide-queries";
import { GUIDE_LIKEABLE, unlikeContent } from "../../../utils/like-helpers";

type GuideRow = typeof guides.$inferSelect;

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");
  const userId = requireUser(event);
  const database = getDb();

  // Same readability gate as the like path (see like.post.ts): unlike stays
  // symmetric with like so both agree on which guides are actionable, rather
  // than letting an unlike succeed on a guide a like would now reject.
  await loadReadableGuide(database, id, userId);

  const updated = await unlikeContent<GuideRow>(
    database,
    GUIDE_LIKEABLE,
    id,
    userId,
  );

  return { id, likeCount: updated.likeCount, likedByCurrentUser: false };
});
