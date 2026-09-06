import {
  fetchPublicGuides,
  requireViewableProfileTarget,
} from "../../../utils/profile-queries";

export default defineEventHandler(async (event) => {
  const { database, targetUserId } = await requireViewableProfileTarget(event);

  const { guides, hasMore } = await fetchPublicGuides(database, targetUserId);

  return { guides, hasMore };
});
