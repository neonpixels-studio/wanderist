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

export interface FetchEntriesFilters {
  tripId?: string;
  placeId?: string;
  tab?: "timeline" | "by-trip" | "photos";
  page?: number;
}

export interface FetchEntriesResult {
  entries: Entry[];
  tab: string;
  page: number;
  hasMore: boolean;
}

type FilterParam = [key: string, value: string | undefined];

function buildEntriesQuery(filters?: FetchEntriesFilters): string {
  const paramPairs: FilterParam[] = [
    ["tripId", filters?.tripId],
    ["placeId", filters?.placeId],
    ["tab", filters?.tab],
    ["page", filters?.page !== undefined ? String(filters.page) : undefined],
  ];

  const params = new URLSearchParams(
    paramPairs.filter(
      (pair): pair is [string, string] => pair[1] !== undefined,
    ),
  );

  const queryString = params.toString();
  return queryString ? `/api/entries?${queryString}` : "/api/entries";
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

  async function fetchEntries(
    filters?: FetchEntriesFilters,
  ): Promise<FetchEntriesResult> {
    isLoading.value = true;
    error.value = null;

    try {
      const result = await apiFetch<FetchEntriesResult>(
        buildEntriesQuery(filters),
      );
      entries.value = result.entries;
      return result;
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
