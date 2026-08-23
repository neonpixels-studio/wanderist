import { requireRouterParam } from "../../../utils/db-helpers";
import { requireUser } from "../../../utils/auth";
import { getDb } from "../../../db/index";
import { guides } from "../../../db/schema";
import { loadReadableGuide } from "../../../utils/guide-queries";
import { GUIDE_LIKEABLE, likeContent } from "../../../utils/like-helpers";
import { notifyAuthorOfLike } from "../../../utils/notification-helpers";

type GuideRow = typeof guides.$inferSelect;

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");
  const userId = requireUser(event);
  const database = getDb();

  // Gate the like on the same rule as reading the guide: a non-owner may only
  // like a public guide whose author is still discoverable (live account,
  // public profile, effective entitlement, opted into explore). Reusing
  // loadReadableGuide keeps the like path from drifting from the read path, so
  // a lapsed author's guide that now 404s on read can't stay likeable by id.
  const guide = await loadReadableGuide(database, id, userId);

  const { content, created } = await likeContent<GuideRow>(
    database,
    GUIDE_LIKEABLE,
    id,
    userId,
  );

  if (created) {
    await notifyAuthorOfLike({
      authorId: guide.userId,
      likerId: userId,
      contentType: "guide",
    });
  }

  return { id, likeCount: content.likeCount, likedByCurrentUser: true };
});
