import { getDb } from "../../db/index";
import { requireUser } from "../../utils/auth";
import { fetchNotificationsForUser } from "../../utils/notification-helpers";
import { MAX_PAGE, parsePageParam, pageToOffset } from "../../utils/pagination";

const PAGE_SIZE = 50;

export default defineEventHandler(async (event) => {
  const userId = requireUser(event);
  const database = getDb();
  const query = getQuery(event);

  const page = parsePageParam(query.page);
  const offset = pageToOffset(page, PAGE_SIZE);

  const rows = await fetchNotificationsForUser(
    database,
    userId,
    PAGE_SIZE,
    offset,
  );

  return {
    notifications: rows,
    page,
    hasMore: rows.length === PAGE_SIZE && page < MAX_PAGE,
  };
});
