import { defineStore } from "pinia";

export interface EntryPhoto {
  id: string;
  entryId: string;
  mediaId: string;
  sortOrder: number;
}

export interface EntryTag {
  id: string;
  name: string;
}

export interface Entry {
  id: string;
  userId: string;
  tripId: string | null;
  placeId: string | null;
  title: string;
  body: string | null;
  occurredAt: string | null;
  visibility: "private" | "public";
  weather: string | null;
  likeCount: number;
  // Whether the current user has liked this entry, server-derived from the
  // entry_likes join table (survives a reload, unlike the old session Set).
  // Optional because the list/detail read paths and the like/unlike responses
  // populate it, but create/update/on-this-day responses don't — a freshly
  // created or edited entry's like state is read from the page's liked set, not
  // this field.
  likedByCurrentUser?: boolean;
  // JSON-serialized ISO strings from the API; not Date objects at runtime.
  createdAt: string;
  updatedAt: string;
  photos: EntryPhoto[];
  tags: EntryTag[];
}

export interface CreateEntryInput {
  title: string;
  body?: string;
  occurredAt?: string;
  tripId?: string;
  placeId?: string;
  tags?: string[];
  photoMediaIds?: string[];
  visibility?: "private" | "public";
  weather?: string;
}

export type UpdateEntryInput = Partial<CreateEntryInput>;

// Opens the entry drawer in edit mode for the given entry. Provided by the app
// layout and injected by the pages that list entries.
export type EditEntryHandler = (entry: Entry) => void;

export interface FetchEntriesFilters {
  tripId?: string;
  placeId?: string;
  tab?: "timeline" | "by-trip" | "photos";
}

export interface FetchEntriesResult {
  entries: Entry[];
  tab: string;
  page: number;
  hasMore: boolean;
}

// Safety net against an infinite loop if the API ever reports `hasMore: true`
// forever (e.g. a server bug) — no user has anywhere near this many entries,
// so hitting this cap always indicates a bug, not a real result set.
const MAX_ENTRIES_PAGES = 500;

type FilterParam = [key: string, value: string | undefined];

function buildEntriesQuery(
  filters: FetchEntriesFilters | undefined,
  page: number,
): string {
  const paramPairs: FilterParam[] = [
    ["tripId", filters?.tripId],
    ["placeId", filters?.placeId],
    ["tab", filters?.tab],
    ["page", String(page)],
  ];

  const params = new URLSearchParams(
    paramPairs.filter(
      (pair): pair is [string, string] => pair[1] !== undefined,
    ),
  );

  return `/api/entries?${params.toString()}`;
}

function replaceLikeState(list: Entry[], updated: Entry): Entry[] {
  return list.map((entry) =>
    entry.id === updated.id
      ? {
          ...entry,
          likeCount: updated.likeCount,
          likedByCurrentUser: updated.likedByCurrentUser,
        }
      : entry,
  );
}

function setError(error: Ref<string | null>, caught: unknown): void {
  error.value =
    caught instanceof Error ? caught.message : "An unexpected error occurred";
}

export const useEntriesStore = defineStore("entries", () => {
  const { apiFetch } = useApiClient();

  const entries = ref<Entry[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // GET /api/entries is paginated server-side to keep each query bounded (see
  // server/api/entries/index.get.ts, PAGE_SIZE = 20), but the journal feed,
  // home dashboard, and post-create refresh all need the user's full history —
  // the Timeline/By-trip/Photos groupings are computed client-side over the
  // whole list. Rather than invent a partial-list contract for those callers,
  // this walks every page and concatenates the results, so the store's public
  // `entries` list keeps behaving like "all of the user's entries" — matching
  // the places and trips stores' fetchAll*Pages convention.
  async function fetchAllEntriesPages(
    filters?: FetchEntriesFilters,
  ): Promise<Entry[]> {
    const allEntries: Entry[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      if (page > MAX_ENTRIES_PAGES) {
        // Bailing out here would silently hand every consumer a truncated list
        // dressed up as the full one — fail loud instead so the UI surfaces the
        // failure via the existing error handling below.
        throw new Error(
          `fetchEntries exceeded ${MAX_ENTRIES_PAGES} pages — the API kept reporting hasMore: true`,
        );
      }

      const result = await apiFetch<FetchEntriesResult>(
        buildEntriesQuery(filters, page),
      );

      if (
        !Array.isArray(result?.entries) ||
        typeof result?.hasMore !== "boolean"
      ) {
        throw new Error(
          "Malformed /api/entries response: expected { entries: Entry[], hasMore: boolean }",
        );
      }

      allEntries.push(...result.entries);
      hasMore = result.hasMore;
      page += 1;
    }

    return allEntries;
  }

  async function fetchEntries(filters?: FetchEntriesFilters): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      entries.value = await fetchAllEntriesPages(filters);
    } catch (caught) {
      setError(error, caught);
      throw caught;
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchEntry(id: string): Promise<Entry> {
    error.value = null;
    try {
      return await apiFetch<Entry>(`/api/entries/${id}`);
    } catch (caught) {
      setError(error, caught);
      throw caught;
    }
  }

  async function createEntry(input: CreateEntryInput): Promise<Entry> {
    error.value = null;
    try {
      const created = await apiFetch<Entry>("/api/entries", {
        method: "POST",
        body: input,
      });

      // Prepend so the newest entry appears first, matching server sort order
      // (occurredAt desc nulls last, createdAt desc). Note: a backdated
      // occurredAt may place the entry out of order until the next refetch.
      entries.value = [created, ...entries.value];

      return created;
    } catch (caught) {
      setError(error, caught);
      throw caught;
    }
  }

  async function updateEntry(
    id: string,
    input: UpdateEntryInput,
  ): Promise<Entry> {
    error.value = null;
    try {
      const updated = await apiFetch<Entry>(`/api/entries/${id}`, {
        method: "PATCH",
        body: input,
      });

      entries.value = entries.value.map((entry) =>
        entry.id === id ? updated : entry,
      );

      return updated;
    } catch (caught) {
      setError(error, caught);
      throw caught;
    }
  }

  async function deleteEntry(id: string): Promise<void> {
    error.value = null;
    try {
      await apiFetch(`/api/entries/${id}`, { method: "DELETE" });
      entries.value = entries.value.filter((entry) => entry.id !== id);
    } catch (caught) {
      setError(error, caught);
      throw caught;
    }
  }

  async function likeEntry(id: string): Promise<Entry> {
    error.value = null;
    try {
      const updated = await apiFetch<Entry>(`/api/entries/${id}/like`, {
        method: "POST",
      });

      entries.value = replaceLikeState(entries.value, updated);

      return updated;
    } catch (caught) {
      setError(error, caught);
      throw caught;
    }
  }

  async function unlikeEntry(id: string): Promise<Entry> {
    error.value = null;
    try {
      const updated = await apiFetch<Entry>(`/api/entries/${id}/like`, {
        method: "DELETE",
      });

      entries.value = replaceLikeState(entries.value, updated);

      return updated;
    } catch (caught) {
      setError(error, caught);
      throw caught;
    }
  }

  return {
    entries,
    isLoading,
    error,
    fetchEntries,
    fetchEntry,
    createEntry,
    updateEntry,
    deleteEntry,
    likeEntry,
    unlikeEntry,
  };
});
