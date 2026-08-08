import { defineStore } from "pinia";
import { extractErrorMessage } from "~/utils/extractErrorMessage";

export type GuideVisibility = "private" | "public";

export interface Guide {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  readTimeMinutes: number;
  likeCount: number;
  // Whether the current user has liked this guide, server-derived from the
  // guide_likes join table (survives a reload, unlike the old session Set).
  // Optional because the list read path and the like/unlike responses populate
  // it, but create/update responses don't — a freshly created or edited guide's
  // like state is read from the page's liked set, not this field.
  likedByCurrentUser?: boolean;
  visibility: GuideVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGuideInput {
  title: string;
  body?: string;
  readTimeMinutes?: number;
  visibility?: GuideVisibility;
}

export type UpdateGuideInput = Partial<CreateGuideInput>;

export interface FetchGuidesResult {
  guides: Guide[];
  page: number;
  hasMore: boolean;
}

// Safety net against an infinite loop if the API ever reports `hasMore: true`
// forever (e.g. a server bug) — no user has anywhere near this many guides,
// so hitting this cap always indicates a bug, not a real result set.
const MAX_GUIDES_PAGES = 500;

// Only the like fields are spliced back in (not the whole row) so a concurrent
// edit to the same guide's other fields isn't clobbered by a like/unlike
// response that predates it.
function replaceLikeState(list: Guide[], updated: Guide): Guide[] {
  return list.map((guide) =>
    guide.id === updated.id
      ? {
          ...guide,
          likeCount: updated.likeCount,
          likedByCurrentUser: updated.likedByCurrentUser,
        }
      : guide,
  );
}

export const useGuidesStore = defineStore("guides", () => {
  const { apiFetch } = useApiClient();

  const guides = ref<Guide[]>([]);
  // Holds the single guide shown on the detail page (/guides/[id]). Kept
  // separate from the `guides` list because a guide can be opened from explore
  // without ever loading the owner's full list, and the detail fetch returns a
  // guide the list may not contain (e.g. someone else's public guide).
  const currentGuide = ref<Guide | null>(null);
  const isLoadingGuide = ref(false);
  const guideError = ref<string | null>(null);
  const isLoading = ref(false);
  // Distinct from isLoading: lets a consumer tell "haven't fetched yet" apart
  // from "fetched and the list is genuinely empty", so a page doesn't flash
  // an empty state before its first fetch resolves.
  const hasLoaded = ref(false);
  const error = ref<string | null>(null);
  // Dedupes concurrent fetchGuides() calls into one request. Without this, a
  // slow mount-triggered fetch overlapping a retry click — or a create/update/
  // delete's markLoadSucceeded() refetch firing while the mount fetch is still
  // in flight — starts a second, redundant request racing the first; whichever
  // settles last wins, which can overwrite fresher state with a stale response.
  let inFlightFetch: Promise<void> | null = null;

  async function fetchGuides(): Promise<void> {
    if (inFlightFetch) {
      return inFlightFetch;
    }

    inFlightFetch = runFetchGuides().finally(() => {
      inFlightFetch = null;
    });

    return inFlightFetch;
  }

  // GET /api/guides is paginated server-side to keep each query bounded (see
  // server/api/guides/index.get.ts), but every UI consumer still needs the
  // full list. Rather than invent a partial-list contract for those callers,
  // this walks every page and concatenates the results, so the store's public
  // `guides` list keeps behaving like "all of the user's guides". Mirrors
  // fetchAllTripsPages in stores/trips.ts.
  async function fetchAllGuidesPages(): Promise<Guide[]> {
    const allGuides: Guide[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      if (page > MAX_GUIDES_PAGES) {
        // Bailing out here would silently hand every consumer a truncated
        // list dressed up as the full one — fail loud instead so the UI
        // surfaces the failure via the existing error handling below.
        throw new Error(
          `fetchGuides exceeded ${MAX_GUIDES_PAGES} pages — the API kept reporting hasMore: true`,
        );
      }

      const result = await apiFetch<FetchGuidesResult>(
        `/api/guides?page=${page}`,
      );

      if (
        !Array.isArray(result?.guides) ||
        typeof result?.hasMore !== "boolean"
      ) {
        throw new Error(
          "Malformed /api/guides response: expected { guides: Guide[], hasMore: boolean }",
        );
      }

      allGuides.push(...result.guides);
      hasMore = result.hasMore;
      page += 1;
    }

    return allGuides;
  }

  async function runFetchGuides(): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      guides.value = await fetchAllGuidesPages();
      // Set only on success: a failed fetch must not read as "loaded and
      // genuinely empty" (see hasLoaded's comment above) — it should keep
      // reading as "not loaded" so the page keeps showing the error instead
      // of also rendering the empty state underneath it.
      hasLoaded.value = true;
    } catch (fetchError) {
      error.value = extractErrorMessage(fetchError);
      throw fetchError;
    } finally {
      isLoading.value = false;
    }
  }

  // Monotonic token identifying the most recent fetchGuideById call. Keying on
  // a per-call token (not the id) means even two in-flight requests for the
  // SAME id — e.g. /guides/a -> /guides/b -> /guides/a via back/forward — are
  // distinguished, so a slower earlier request can't overwrite the newer
  // guide, blank it out on a late failure, or clear the loading flag while the
  // newer one is still in flight. Same intent as fetchGuides' inFlightFetch
  // guard, for a fetch that legitimately reruns per id.
  let latestGuideRequestId = 0;

  async function fetchGuideById(id: string): Promise<void> {
    const requestId = ++latestGuideRequestId;
    isLoadingGuide.value = true;
    guideError.value = null;

    try {
      const guide = await apiFetch<Guide>(`/api/guides/${id}`);
      if (requestId !== latestGuideRequestId) {
        return;
      }
      currentGuide.value = guide;
    } catch (fetchError) {
      if (requestId !== latestGuideRequestId) {
        throw fetchError;
      }
      // Clear any stale guide so the detail page shows its not-found state
      // rather than the previously-open guide when a fetch fails.
      currentGuide.value = null;
      guideError.value = extractErrorMessage(fetchError);
      throw fetchError;
    } finally {
      if (requestId === latestGuideRequestId) {
        isLoadingGuide.value = false;
      }
    }
  }

  // A successful write only proves the single mutated guide reflects server
  // state, not that `guides` holds the user's complete set. If the initial
  // load never succeeded (hasLoaded still false), `guides` may be missing
  // rows the server has — e.g. it's `[]` after a failed fetchGuides — and a
  // create/update/delete here must not be allowed to make that incomplete
  // list look authoritative. In that case, await a real refetch instead of
  // trusting the local mutation. Once hasLoaded is already true, a write's
  // optimistic mutation is enough and no refetch is needed — just clear any
  // stale load error.
  async function markLoadSucceeded(): Promise<void> {
    if (!hasLoaded.value) {
      await fetchGuides().catch(() => {
        // fetchGuides already records the failure in `error`; nothing further
        // to do here.
      });
      return;
    }

    error.value = null;
  }

  async function createGuide(input: CreateGuideInput): Promise<Guide> {
    const created = await apiFetch<Guide>("/api/guides", {
      method: "POST",
      body: input,
    });

    guides.value = [created, ...guides.value];
    await markLoadSucceeded();

    return created;
  }

  async function updateGuide(
    id: string,
    input: UpdateGuideInput,
  ): Promise<Guide> {
    const updated = await apiFetch<Guide>(`/api/guides/${id}`, {
      method: "PATCH",
      body: input,
    });

    guides.value = guides.value.map((guide) =>
      guide.id === id ? updated : guide,
    );
    // Keep the open detail page (which renders from currentGuide, not the
    // list) in sync so an edit doesn't leave it showing pre-edit content.
    if (currentGuide.value?.id === id) {
      currentGuide.value = updated;
    }
    await markLoadSucceeded();

    return updated;
  }

  async function deleteGuide(id: string): Promise<void> {
    await apiFetch(`/api/guides/${id}`, { method: "DELETE" });

    guides.value = guides.value.filter((guide) => guide.id !== id);
    // Drop the open detail page's guide if it was the one deleted, so it can't
    // keep rendering a row that no longer exists.
    if (currentGuide.value?.id === id) {
      currentGuide.value = null;
    }
    await markLoadSucceeded();
  }

  // Splices in only the like fields via replaceLikeState (see its comment);
  // mirrors likeEntry in stores/entries.ts.
  async function likeGuide(id: string): Promise<Guide> {
    const updated = await apiFetch<Guide>(`/api/guides/${id}/like`, {
      method: "POST",
    });

    guides.value = replaceLikeState(guides.value, updated);

    return updated;
  }

  async function unlikeGuide(id: string): Promise<Guide> {
    const updated = await apiFetch<Guide>(`/api/guides/${id}/like`, {
      method: "DELETE",
    });

    guides.value = replaceLikeState(guides.value, updated);

    return updated;
  }

  return {
    guides,
    currentGuide,
    isLoadingGuide,
    guideError,
    isLoading,
    hasLoaded,
    error,
    fetchGuides,
    fetchGuideById,
    createGuide,
    updateGuide,
    deleteGuide,
    likeGuide,
    unlikeGuide,
  };
});
