import { loadOwnedOrThrow, requireRouterParam } from "../../utils/db-helpers";
import { requireUser } from "../../utils/auth";
import { getDb } from "../../db/index";
import { entries } from "../../db/schema";
import { loadEntryRelations } from "../../utils/entry-helpers";
import { ENTRY_LIKEABLE, hasLiked } from "../../utils/like-helpers";

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");
  const userId = requireUser(event);

  const entry = await loadOwnedOrThrow(
    event,
    entries,
    entries.id,
    entries.userId,
    id,
  );

  const database = getDb();
  const [relations, likedByCurrentUser] = await Promise.all([
    loadEntryRelations(database, id),
    hasLiked(database, ENTRY_LIKEABLE, id, userId),
  ]);

  return { ...entry, ...relations, likedByCurrentUser };
});
