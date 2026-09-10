import { eq } from "drizzle-orm";
import { getDb } from "../../db/index";
import { notifications } from "../../db/schema";
import { assertOwnership, requireRouterParam } from "../../utils/db-helpers";

// Hard delete rather than a soft-delete flag: notifications have no other
// archival/undo affordance (unlike e.g. trips or entries), so once dismissed
// there is nothing left worth keeping around. Mirrors the delete shape used
// by server/api/places/[id].delete.ts.
export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");

  await assertOwnership(
    event,
    notifications,
    notifications.id,
    notifications.userId,
    id,
  );

  const database = getDb();

  await database.delete(notifications).where(eq(notifications.id, id));

  return { success: true };
});
