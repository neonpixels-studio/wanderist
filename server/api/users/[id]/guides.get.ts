import {
  fetchPublicGuides,
  requireViewableProfileTarget,
} from "../../../utils/profile-queries";

export default defineEventHandler(async (event) => {
  const { database, targetUserId, viewerId } =
    await requireViewableProfileTarget(event);

  const { guides, hasMore } = await fetchPublicGuides(
    database,
    targetUserId,
    viewerId,
  );

  return { guides, hasMore };
});
