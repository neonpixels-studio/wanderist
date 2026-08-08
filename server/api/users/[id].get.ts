import { getDb } from "../../db/index";
import { requireUser } from "../../utils/auth";
import { requireRouterParam } from "../../utils/db-helpers";
import { requireViewableProfile } from "../../utils/profile-queries";

export default defineEventHandler(async (event) => {
  const currentUserId = requireUser(event);
  const targetUserId = requireRouterParam(event, "id");
  const database = getDb();

  const profile = await requireViewableProfile(
    database,
    currentUserId,
    targetUserId,
  );

  return { ...profile, isSelf: currentUserId === targetUserId };
});
