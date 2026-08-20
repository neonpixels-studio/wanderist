import { eq, and, asc, desc } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDb } from "../../db/index";
import { trips, TRIP_STATUS } from "../../db/schema";
import { requireUser } from "../../utils/auth";
import { MAX_PAGE, parsePageParam, pageToOffset } from "../../utils/pagination";

const VALID_STATUSES = [
  TRIP_STATUS.ONGOING,
  TRIP_STATUS.UPCOMING,
  TRIP_STATUS.PAST,
] as const;

type TripStatus = (typeof VALID_STATUSES)[number];

function isValidStatus(value: unknown): value is TripStatus {
  return VALID_STATUSES.includes(value as TripStatus);
}

function parseStatusFilter(value: unknown): TripStatus | null {
  if (value === undefined || value === null || value === "All") {
    return null;
  }

  if (!isValidStatus(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid status filter. Must be one of: ${VALID_STATUSES.join(", ")}`,
    });
  }

  return value;
}

const VALID_SORT_ORDERS = ["asc", "desc"] as const;

type SortOrder = (typeof VALID_SORT_ORDERS)[number];

function parseSortOrder(value: unknown): SortOrder {
  if (value === undefined || value === null) {
    return "desc";
  }

  if (!VALID_SORT_ORDERS.includes(value as SortOrder)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid sort order. Must be one of: ${VALID_SORT_ORDERS.join(", ")}`,
    });
  }

  return value as SortOrder;
}

const PAGE_SIZE = 20;

function buildFilters(userId: string, statusFilter: TripStatus | null): SQL[] {
  const filters: SQL[] = [eq(trips.userId, userId)];

  if (statusFilter) {
    filters.push(eq(trips.status, statusFilter));
  }

  return filters;
}

async function fetchTripsPage(
  database: ReturnType<typeof getDb>,
  filters: SQL[],
  sortOrder: SortOrder,
  page: number,
): Promise<(typeof trips.$inferSelect)[]> {
  // `id` is a unique secondary sort key purely to break ties within a single
  // query when multiple trips share a createdAt (e.g. a bulk import) —
  // without it, which of the tied rows lands on which side of a page
  // boundary is unspecified. It follows the same direction as the requested
  // sort so page boundaries stay stable across a walk. This does not
  // protect against a trip being created or deleted while a client is
  // mid-walk across pages; see the PR description for why that's an
  // accepted tradeoff.
  const orderColumns =
    sortOrder === "asc"
      ? [asc(trips.createdAt), asc(trips.id)]
      : [desc(trips.createdAt), desc(trips.id)];

  return database
    .select()
    .from(trips)
    .where(and(...filters))
    .orderBy(...orderColumns)
    .limit(PAGE_SIZE)
    .offset(pageToOffset(page, PAGE_SIZE));
}

export default defineEventHandler(async (event) => {
  const userId = requireUser(event);
  const database = getDb();
  const query = getQuery(event);

  const statusFilter = parseStatusFilter(query.status);
  const sortOrder = parseSortOrder(query.sort);
  const page = parsePageParam(query.page);
  const filters = buildFilters(userId, statusFilter);

  const rows = await fetchTripsPage(database, filters, sortOrder, page);

  return {
    trips: rows,
    page,
    hasMore: rows.length === PAGE_SIZE && page < MAX_PAGE,
  };
});
