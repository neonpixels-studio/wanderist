import { eq, and, desc } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { requireUser } from "../../utils/auth";
import { getDb } from "../../db/index";
import { places } from "../../db/schema";
import { MAX_PAGE, parsePageParam, pageToOffset } from "../../utils/pagination";

const PAGE_SIZE = 20;

function buildFilters(userId: string, query: Record<string, unknown>): SQL[] {
  const filters: SQL[] = [eq(places.userId, userId)];

  const categoryFilter = query.category;
  if (typeof categoryFilter === "string") {
    const categoryTrimmed = categoryFilter.trim();
    if (categoryTrimmed !== "") {
      filters.push(eq(places.category, categoryTrimmed));
    }
  }

  return filters;
}

async function fetchPlacesPage(
  database: ReturnType<typeof getDb>,
  filters: SQL[],
  page: number,
): Promise<(typeof places.$inferSelect)[]> {
  return (
    database
      .select()
      .from(places)
      .where(and(...filters))
      // `id` is a unique secondary sort key purely to break ties within a
      // single query when multiple rows share a createdAt (e.g. a bulk
      // import) — without it, which of the tied rows lands on which side of
      // a page boundary is unspecified. This does not protect against a
      // place being created or deleted while a client is mid-walk across
      // pages; see the PR description for why that's an accepted tradeoff.
      .orderBy(desc(places.createdAt), desc(places.id))
      .limit(PAGE_SIZE)
      .offset(pageToOffset(page, PAGE_SIZE))
  );
}

export default defineEventHandler(async (event) => {
  const userId = requireUser(event);
  const database = getDb();
  const query = getQuery(event) as Record<string, unknown>;

  const page = parsePageParam(query.page);
  const filters = buildFilters(userId, query);

  const rows = await fetchPlacesPage(database, filters, page);

  return {
    places: rows,
    page,
    hasMore: rows.length === PAGE_SIZE && page < MAX_PAGE,
  };
});
