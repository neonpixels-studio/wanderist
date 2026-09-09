import {
  fetchPublicTrips,
  requireViewableProfileTarget,
} from "../../../utils/profile-queries";

export default defineEventHandler(async (event) => {
  const { database, targetUserId } = await requireViewableProfileTarget(event);

  const { trips, hasMore } = await fetchPublicTrips(database, targetUserId);

  return { trips, hasMore };
});
