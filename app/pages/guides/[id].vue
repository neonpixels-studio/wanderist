<template>
  <div v-if="isLoading" class="content content--wide">
    <div class="empty-note">Loading guide…</div>
  </div>

  <div v-else-if="!guide" class="content content--wide">
    <div class="empty-note">{{ guideError ?? "Guide not found." }}</div>
    <NuxtLink to="/guides" class="btn btn--outline btn--sm gdetail__back">
      back to guides
    </NuxtLink>
  </div>

  <article v-else class="content content--wide gdetail">
    <NuxtLink to="/guides" class="gdetail__back-link">
      <AppIcon name="arrow-left" :size="14" />
      guides
    </NuxtLink>

    <header class="gdetail__head">
      <h1>{{ guide.title }}</h1>
      <div class="gdetail__meta">
        <span class="m">
          <AppIcon name="clock" :size="12" />
          {{ guide.readTimeMinutes }} min read
        </span>
        <span class="m">
          <AppIcon name="heart" :size="12" />
          {{ guide.likeCount }}
        </span>
        <span class="tag" :class="visibilityTagClass">
          {{ guide.visibility }}
        </span>
      </div>
    </header>

    <div v-if="guide.body" class="gdetail__body">{{ guide.body }}</div>
    <div v-else class="empty-note">This guide has no content yet.</div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useGuidesStore } from "~/stores/guides";
import type { GuideVisibility } from "~/stores/guides";

// No auth middleware: a public guide must open for anonymous visitors following
// a shared link. The GET endpoint enforces visibility — a private or
// non-discoverable guide returns 404, which this page renders as its not-found
// state (it never redirects to /login), so private guides stay protected.
definePageMeta({ layout: "app" });

const VISIBILITY_TAG_CLASS: Record<GuideVisibility, string> = {
  public: "tag--ongoing",
  private: "tag--past",
};

const route = useRoute();
const guideId = computed(() => String(route.params.id));

const guidesStore = useGuidesStore();

// Guard against the render window during in-page navigation (g-1 -> g-2): the
// route id updates reactively before the refetch flips isLoadingGuide, so only
// show currentGuide once it actually matches the id in the URL.
const guide = computed(() =>
  guidesStore.currentGuide?.id === guideId.value
    ? guidesStore.currentGuide
    : null,
);
const guideError = computed(() => guidesStore.guideError);

// `server: false` keeps the fetch client-only, mirroring u/[id].vue: the request
// carries the Clerk session token, which only exists on the client (Clerk runs
// with skipServerMiddleware). Running it during SSR would hang, since Clerk's
// getToken never resolves on the server. A failed load rejects (no .catch); the
// store records guideError / nulls currentGuide, so the template renders its
// not-found / error state — an anonymous visitor on a private or missing guide
// sees "Guide not found" rather than being redirected to /login. This does mean
// a shared link is not server-rendered (no unfurl preview); that is an accepted
// trade for staying on the codebase's client-only-auth pattern.
const { status: fetchStatus } = useAsyncData(
  () => `guide-detail-${guideId.value}`,
  () => guidesStore.fetchGuideById(guideId.value),
  { server: false, watch: [guideId] },
);

// Until the client fetch resolves, the SSR pass and hydration frame have no
// guide yet. Treat that window as loading so a valid public guide never flashes
// "Guide not found" (which SSR would otherwise emit) before its data arrives.
const hasResolvedFetch = computed(
  () => fetchStatus.value === "success" || fetchStatus.value === "error",
);
const isLoading = computed(
  () => guidesStore.isLoadingGuide || !hasResolvedFetch.value,
);

const visibilityTagClass = computed(() =>
  guide.value ? VISIBILITY_TAG_CLASS[guide.value.visibility] : "",
);

useHead(
  computed(() => ({
    title: guide.value
      ? `Wanderist — ${guide.value.title}`
      : "Wanderist — Guide",
  })),
);
</script>

<style scoped>
.gdetail {
  /* Breathing room after a long read so the body never butts against the
     viewport edge on short guides. */
  padding-bottom: 40px;
}
.gdetail__back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  text-decoration: none;
  margin-bottom: 18px;
}
.gdetail__back-link:hover {
  color: var(--accent-ink);
}
.gdetail__head h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.gdetail__meta {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11.5px;
  color: var(--faint);
  margin-top: 10px;
}
.gdetail__meta .m {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.gdetail__body {
  margin-top: 24px;
  font-size: 14.5px;
  line-height: 1.7;
  /* Guide bodies are stored as plain text; preserve the author's line breaks
     and paragraph spacing without an HTML/markdown renderer. */
  white-space: pre-wrap;
}
.gdetail__back {
  margin-top: 16px;
}
/* Scoped per component, matching GuidesList.vue and explore.vue (the codebase's
   established pattern for this muted state text) rather than a global rule. */
.empty-note {
  font-size: 12.5px;
  color: var(--faint);
  padding: 12px 0;
}
</style>
