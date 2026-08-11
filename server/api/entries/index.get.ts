import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { requireUser } from "../../utils/auth";
import { getDb } from "../../db/index";
import { entries, entryPhotos, entryTags, tags } from "../../db/schema";
import { ENTRY_LIKEABLE, likedContentIds } from "../../utils/like-helpers";

const VALID_TABS = ["timeline", "by-trip", "photos"] as const;
type Tab = (typeof VALID_TABS)[number];

const PAGE_SIZE = 20;

function parsePageParam(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function resolveTab(value: unknown): Tab {
  if (VALID_TABS.includes(value as Tab)) {
    return value as Tab;
  }
  return "timeline";
}

function buildFilters(userId: string, query: Record<string, unknown>): SQL[] {
  const filters: SQL[] = [eq(entries.userId, userId)];

  const tripId = query.tripId;
  if (typeof tripId === "string" && tripId.trim() !== "") {
    filters.push(eq(entries.tripId, tripId.trim()));
  }

  const placeId = query.placeId;
  if (typeof placeId === "string" && placeId.trim() !== "") {
    filters.push(eq(entries.placeId, placeId.trim()));
  }

  return filters;
}

function groupByEntryId<T extends { entryId: string }>(
  rows: T[],
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const row of rows) {
    const key = row.entryId;
    groups[key] ??= [];
    groups[key].push(row);
  }
  return groups;
}

async function fetchEntryPhotos(
  database: ReturnType<typeof getDb>,
  entryIds: string[],
) {
  if (entryIds.length === 0) {
    return [];
  }
  return database
    .select()
    .from(entryPhotos)
    .where(inArray(entryPhotos.entryId, entryIds))
    .orderBy(asc(entryPhotos.sortOrder));
}

async function fetchEntryTags(
  database: ReturnType<typeof getDb>,
  entryIds: string[],
) {
  if (entryIds.length === 0) {
    return [];
  }
  return database
    .select({ entryId: entryTags.entryId, tagId: tags.id, tagName: tags.name })
    .from(entryTags)
    .innerJoin(tags, eq(entryTags.tagId, tags.id))
    .where(inArray(entryTags.entryId, entryIds));
}

async function fetchEntryIdsWithPhotos(
  database: ReturnType<typeof getDb>,
  userId: string,
): Promise<string[]> {
  const rows = await database
    .selectDistinct({ entryId: entryPhotos.entryId })
    .from(entryPhotos)
    .innerJoin(entries, eq(entryPhotos.entryId, entries.id))
    .where(eq(entries.userId, userId));

  return rows.map((row) => row.entryId);
}

async function fetchEntriesPage(
  database: ReturnType<typeof getDb>,
  filters: SQL[],
  page: number,
): Promise<(typeof entries.$inferSelect)[]> {
  return database
    .select()
    .from(entries)
    .where(and(...filters))
    .orderBy(
      sql`${entries.occurredAt} desc nulls last`,
      desc(entries.createdAt),
    )
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
}

export default defineEventHandler(async (event) => {
  const userId = requireUser(event);
  const database = getDb();
  const query = getQuery(event) as Record<string, unknown>;

  const tab = resolveTab(query.tab);
  const page = parsePageParam(query.page);
  const filters = buildFilters(userId, query);

  if (tab === "photos") {
    const entryIdsWithPhotos = await fetchEntryIdsWithPhotos(database, userId);

    if (entryIdsWithPhotos.length === 0) {
      return { entries: [], tab, page, hasMore: false };
    }

    filters.push(inArray(entries.id, entryIdsWithPhotos));
  }

  const rows = await fetchEntriesPage(database, filters, page);
  const entryIds = rows.map((row) => row.id);

  const [photos, tagRows, likedIds] = await Promise.all([
    fetchEntryPhotos(database, entryIds),
    fetchEntryTags(database, entryIds),
    likedContentIds(database, ENTRY_LIKEABLE, entryIds, userId),
  ]);

  const photosByEntry = groupByEntryId(photos);
  const tagsByEntry = groupByEntryId(tagRows);

  const result = rows.map((row) => ({
    ...row,
    photos: photosByEntry[row.id] ?? [],
    tags: (tagsByEntry[row.id] ?? []).map((tagRow) => ({
      id: tagRow.tagId,
      name: tagRow.tagName,
    })),
    likedByCurrentUser: likedIds.has(row.id),
  }));

  return { entries: result, tab, page, hasMore: rows.length === PAGE_SIZE };
});
