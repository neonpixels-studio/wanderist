import {
  fetchFollowing,
  requireViewableProfileTarget,
} from "../../../utils/profile-queries";

export default defineEventHandler(async (event) => {
  const { database, targetUserId } = await requireViewableProfileTarget(event);

  const { following, hasMore } = await fetchFollowing(database, targetUserId);

  return { following, hasMore };
});
