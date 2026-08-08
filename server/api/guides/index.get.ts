import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/index";
import { guides } from "../../db/schema";
import { requireUser } from "../../utils/auth";
import { GUIDE_LIKEABLE, likedContentIds } from "../../utils/like-helpers";

const PAGE_SIZE = 20;

// Bounds how deep an offset scan can go — well above the client's own
// MAX_GUIDES_PAGES walk limit (see app/stores/guides.ts), so a legitimate walk
// never hits this; it only stops a malicious/garbage page number (including
// non-safe-integer values like `1e300`, which would otherwise reach the query
// as a huge offset). Mirrors the trips pagination (server/api/trips/index.get.ts).
const MAX_PAGE = 1000;

function parsePageParam(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE) {
    return 1;
  }
  return parsed;
}

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
    .offset((page - 1) * PAGE_SIZE);
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
