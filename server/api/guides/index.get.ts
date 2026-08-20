import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/index";
import { guides } from "../../db/schema";
import { requireUser } from "../../utils/auth";
import { GUIDE_LIKEABLE, likedContentIds } from "../../utils/like-helpers";
import { MAX_PAGE, parsePageParam, pageToOffset } from "../../utils/pagination";

const PAGE_SIZE = 20;

async function fetchGuidesPage(
  database: ReturnType<typeof getDb>,
  userId: string,
  page: number,
): Promise<(typeof guides.$inferSelect)[]> {
  // `id` is a unique secondary sort key purely to break ties within a single
  // query when multiple guides share a createdAt (e.g. a bulk import) —
  // without it, which of the tied rows lands on which side of a page boundary
  // is unspecified. This does not protect against a guide being created or
  // deleted while a client is mid-walk across pages; see the PR description
  // for why that's an accepted tradeoff.
  return database
    .select()
    .from(guides)
    .where(eq(guides.userId, userId))
    .orderBy(desc(guides.createdAt), desc(guides.id))
    .limit(PAGE_SIZE)
    .offset(pageToOffset(page, PAGE_SIZE));
}

export default defineEventHandler(async (event) => {
  const userId = requireUser(event);
  const database = getDb();
  const query = getQuery(event);

  const page = parsePageParam(query.page);

  const rows = await fetchGuidesPage(database, userId, page);

  const likedIds = await likedContentIds(
    database,
    GUIDE_LIKEABLE,
    rows.map((row) => row.id),
    userId,
  );

  const guidesWithLikeState = rows.map((row) => ({
    ...row,
    likedByCurrentUser: likedIds.has(row.id),
  }));

  return {
    guides: guidesWithLikeState,
    page,
    hasMore: rows.length === PAGE_SIZE && page < MAX_PAGE,
  };
});
