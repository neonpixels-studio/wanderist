import { getDb } from "../../db/index";
import { optionalUser } from "../../utils/auth";
import { requireRouterParam } from "../../utils/db-helpers";
import { requireViewableProfile } from "../../utils/profile-queries";

export default defineEventHandler(async (event) => {
  // Auth is optional here: a shared public profile link must open for
  // anonymous visitors (#279), the same way /api/trips/[id] and
  // /api/guides/[id] already do. requireViewableProfile still gates strictly
  // — an anonymous (null) viewer is treated as a non-owner and can only read
  // an effectively-public profile; a private one stays hidden behind a 404.
  const currentUserId = optionalUser(event);
  const targetUserId = requireRouterParam(event, "id");
  const database = getDb();

  const profile = await requireViewableProfile(
    database,
    currentUserId,
    targetUserId,
  );

  return { ...profile, isSelf: currentUserId === targetUserId };
});
