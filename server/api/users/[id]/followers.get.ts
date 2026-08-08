import { getDb } from "../../../db/index";
import { requireUser } from "../../../utils/auth";
import { requireRouterParam } from "../../../utils/db-helpers";
import {
  fetchFollowers,
  requireViewableProfile,
} from "../../../utils/profile-queries";

export default defineEventHandler(async (event) => {
  const currentUserId = requireUser(event);
  const targetUserId = requireRouterParam(event, "id");
  const database = getDb();

  // Enforce the same visibility rule as the profile endpoint before listing.
  await requireViewableProfile(database, currentUserId, targetUserId);

  const { followers, hasMore } = await fetchFollowers(database, targetUserId);

  return { followers, hasMore };
});
