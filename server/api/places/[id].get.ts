import { loadOwnedOrThrow, requireRouterParam } from "../../utils/db-helpers";
import { requireUser } from "../../utils/auth";
import { places } from "../../db/schema";
import { applyPreciseLocationPrivacy } from "../../utils/locationPrivacy";

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");

  const place = await loadOwnedOrThrow<typeof places.$inferSelect>(
    event,
    places,
    places.id,
    places.userId,
    id,
  );

  // Owner-only route — see locationPrivacy.ts for why the privacy check is
  // still applied here even though it's a no-op today. Re-reads the resolved
  // session id (no extra I/O) rather than reusing place.userId, so the
  // "viewer" argument stays a viewer id rather than becoming an alias for
  // the row's own owner id.
  const userId = requireUser(event);
  return applyPreciseLocationPrivacy(place, userId);
});
