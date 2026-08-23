<template>
  <div class="content content--wide">
    <AppTopbar title="Explore" crumb="Discover">
      <button
        class="icon-btn"
        aria-label="Search"
        @click="openCommandPalette?.()"
      >
        <AppIcon name="search" :size="18" />
      </button>
      <button
        class="icon-btn"
        aria-label="Alerts"
        @click="openNotifications?.()"
      >
        <AppIcon name="bell" :size="18" />
      </button>
      <button class="btn btn--primary btn--sm" @click="openNewEntry?.()">
        <AppIcon name="plus" :size="14" />
        new entry
      </button>
    </AppTopbar>

    <!-- Hero search -->
    <div class="xhero">
      <div class="topo" />
      <div class="xhero__in">
        <div class="label">// discover</div>
        <h1>Where to next?</h1>
        <p>
          Curated destinations, guides from travelers you follow, and places
          trending across Wanderist.
        </p>
        <label class="xsearch">
          <AppIcon name="search" :size="18" />
          <input
            v-model="heroSearch"
            placeholder="Search a city, country, or kind of place…"
          />
          <span class="kbd">⌘K</span>
        </label>
        <div class="xchips">
          <span
            v-for="chip in SEARCH_CHIPS"
            :key="chip"
            class="xchip"
            @click="heroSearch = chip"
            >{{ chip }}</span
          >
        </div>
        <!-- Hero search results -->
        <div
          v-if="heroSearch.trim() && hasHeroSearchResults"
          class="xsearch-results"
          aria-label="Search results"
        >
          <template
            v-for="(group, groupKey) in heroSearchResultGroups"
            :key="groupKey"
          >
            <div v-if="group.items.length" class="xsearch-group">
              <div class="xsearch-group__label">{{ group.label }}</div>
              <NuxtLink
                v-for="item in group.items"
                :key="item.id"
                :to="item.href"
                class="xsearch-item"
              >
                <AppIcon :name="item.icon" :size="14" />
                <span class="xsearch-item__title">{{ item.title }}</span>
                <span v-if="item.subtitle" class="xsearch-item__sub">{{
                  item.subtitle
                }}</span>
              </NuxtLink>
            </div>
          </template>
        </div>
        <div
          v-else-if="heroSearch.trim() && heroError"
          class="xsearch-empty xsearch-empty--error"
          role="alert"
        >
          {{ heroError }}
        </div>
        <div
          v-else-if="heroSearch.trim() && !heroIsLoading"
          class="xsearch-empty"
        >
          No results for &ldquo;{{ heroSearch }}&rdquo;.
        </div>
      </div>
    </div>

    <!-- Discovery content error -->
    <AppAlert
      v-if="discoverError"
      intent="error"
      :message="discoverError"
      :dismissible="true"
    />

    <!-- Featured destinations -->
    <section class="xsec">
      <div class="sec-head">
        <div>
          <div class="label">// featured trips</div>
          <h2>Destinations to dream on</h2>
        </div>
        <NuxtLink class="btn btn--ghost btn--sm" to="/trips">
          see all
          <AppIcon name="arrow-right" :size="14" />
        </NuxtLink>
      </div>
      <div v-if="isLoading" class="feat-row feat-row--loading" aria-busy="true">
        <div v-for="n in FEATURED_SKELETON_COUNT" :key="n" class="feat ph">
          <div class="topo" />
        </div>
      </div>
      <div v-else-if="featuredTrips.length" class="feat-row">
        <NuxtLink
          v-for="trip in featuredTrips"
          :key="trip.id"
          class="feat ph"
          :to="`/trips/${trip.id}`"
        >
          <div class="topo" />
          <div class="feat__veil" />
          <div class="feat__in">
            <div class="feat__kicker">{{ tripKicker(trip) }}</div>
            <div class="feat__title">{{ trip.name }}</div>
            <div class="feat__meta">
              <span
                ><AppIcon name="pin" :size="12" />
                {{ trip.stopCount }} stops</span
              >
              <span v-if="trip.ownerHandle || trip.ownerDisplayName">
                <AppIcon name="user" :size="12" />
                {{ tripAuthorLabel(trip) }}
              </span>
            </div>
          </div>
        </NuxtLink>
      </div>
      <div v-else class="feat-row feat-row--empty">
        <p class="empty-note">No featured trips yet.</p>
      </div>
    </section>

    <!-- Trending places -->
    <section class="xsec">
      <div class="sec-head">
        <div>
          <div class="label">// trending places</div>
          <h2>Pinned a lot this month</h2>
        </div>
      </div>
      <div class="filter-row">
        <button
          v-for="filter in PLACE_FILTERS"
          :key="filter.label"
          class="fbtn"
          :class="{ 'is-active': activeFilter === filter.label }"
          @click="selectFilter(filter)"
        >
          {{ filter.label }}
        </button>
      </div>
      <div v-if="trendingPlaces.length" class="place-grid">
        <NuxtLink
          v-for="place in trendingPlaces"
          :key="`${place.name}-${place.country}-${place.category}`"
          class="pcard"
          to="/map"
        >
          <div class="pcard__cover ph">
            <div class="topo" />
            <span v-if="place.category" class="pcard__tag tag tag--accent">{{
              place.category
            }}</span>
          </div>
          <div class="pcard__body">
            <div class="pcard__name">{{ place.name }}</div>
            <div v-if="place.country" class="pcard__loc">
              <AppIcon name="pin" :size="11" />
              {{ place.country }}
            </div>
            <div class="pcard__foot">
              <span class="saves">
                <AppIcon name="bookmark" :size="12" />
                {{ formatSaveCount(place.saveCount) }} saves
              </span>
              <span v-if="place.recentSaveCount > 0">
                <AppIcon
                  name="trending"
                  :size="12"
                  style="vertical-align: -2px"
                />
                +{{ place.recentSaveCount }} this month
              </span>
            </div>
          </div>
        </NuxtLink>
      </div>
      <div v-else-if="!isLoading" class="place-grid place-grid--empty">
        <p class="empty-note">No trending places for this filter yet.</p>
      </div>
    </section>

    <!-- Guides + People -->
    <section class="xsec">
      <div class="two-col">
        <!-- Guides -->
        <div>
          <div class="sec-head">
            <div>
              <div class="label">// guides</div>
              <h2>Reads for your next trip</h2>
            </div>
          </div>
          <div v-if="guides.length">
            <NuxtLink
              v-for="guide in guides"
              :key="guide.id"
              class="guide"
              to="/journal"
            >
              <div class="guide__thumb ph">
                <div class="topo" style="opacity: 0.4" />
              </div>
              <div>
                <div class="guide__name">{{ guide.title }}</div>
                <div class="guide__by">{{ guideAuthorLabel(guide) }}</div>
                <div class="guide__meta">
                  <span class="m">
                    <AppIcon name="clock" :size="12" />
                    {{ guide.readTimeMinutes }} min read
                  </span>
                  <span class="m">
                    <AppIcon name="heart" :size="12" />
                    {{ guide.likeCount }}
                  </span>
                </div>
              </div>
            </NuxtLink>
          </div>
          <div v-else-if="!isLoading" class="empty-note">
            No guides available yet.
          </div>
        </div>

        <!-- People -->
        <div>
          <div class="sec-head">
            <div>
              <div class="label">// people</div>
              <h2>Travelers to follow</h2>
            </div>
          </div>
          <AppAlert
            v-if="followError"
            intent="error"
            :message="followError"
            :dismissible="true"
          />
          <div class="card card--pad" style="padding: 16px 18px">
            <div v-for="person in people" :key="person.userId" class="person">
              <span class="person__av">
                <AppIcon name="user" :size="19" />
              </span>
              <NuxtLink
                class="person__name"
                :to="`/u/${encodeURIComponent(person.userId)}`"
              >
                <b>{{ personDisplayName(person) }}</b>
                <span>{{ personSubline(person) }}</span>
              </NuxtLink>
              <button
                class="btn btn--sm"
                :class="person.following ? 'btn--primary' : 'btn--outline'"
                :disabled="person.pending"
                @click="toggleFollow(person.userId)"
              >
                <template v-if="person.following">
                  <AppIcon name="check" :size="14" />
                  following
                </template>
                <template v-else>follow</template>
              </button>
            </div>
            <div v-if="!isLoading && people.length === 0" class="empty-note">
              No suggested people right now.
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { PLACE_CATEGORIES } from "~/constants/placeCategories";
import type {
  FeaturedTrip,
  DiscoverGuide,
  SuggestedPerson,
} from "~/composables/useDiscover";
import { DEFAULT_TRAVELER_NAME, formatHandle } from "~/utils/travelerLabels";

const openNotifications = inject<(() => void) | undefined>(
  "openNotifications",
  undefined,
);

const openNewEntry = inject<(() => void) | undefined>(
  "openNewEntry",
  undefined,
);

const openCommandPalette = inject<(() => void) | undefined>(
  "openCommandPalette",
  undefined,
);

definePageMeta({ layout: "app", middleware: "auth" });
useHead({ title: "Wanderist — Explore" });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEARCH_CHIPS = [
  "Cold-water swims",
  "Northern lights",
  "Slow coastlines",
  "Food cities",
  "Off-season Europe",
] as const;

const PLACE_FILTERS: { label: string; category: string | null }[] = [
  { label: "All", category: null },
  ...PLACE_CATEGORIES.map((placeCategory) => ({
    label: placeCategory.label,
    category: placeCategory.value,
  })),
];

const FEATURED_SKELETON_COUNT = 3;

// ---------------------------------------------------------------------------
// Hero search (wired to global search backend via useSearch)
// ---------------------------------------------------------------------------

const {
  query: heroSearch,
  results: heroSearchResults,
  isLoading: heroIsLoading,
  error: heroError,
  search: heroDoSearch,
} = useSearch();

const heroSearchResultGroups = computed(() => ({
  places: { label: "Places", items: heroSearchResults.value.places },
  trips: { label: "Trips", items: heroSearchResults.value.trips },
  entries: { label: "Journal", items: heroSearchResults.value.entries },
  guides: { label: "Guides", items: heroSearchResults.value.guides },
  people: { label: "People", items: heroSearchResults.value.people },
}));

const hasHeroSearchResults = computed(() =>
  Object.values(heroSearchResultGroups.value).some(
    (group) => group.items.length > 0,
  ),
);

watch(heroSearch, (newQuery) => {
  heroDoSearch(newQuery);
});

// ---------------------------------------------------------------------------
// Discovery data
// ---------------------------------------------------------------------------

const activeFilter = ref("All");

const {
  featuredTrips,
  trendingPlaces,
  guides,
  suggestedPeople,
  isLoading,
  error: discoverError,
  fetchAll,
  fetchTrendingPlaces,
} = useDiscover();

// ---------------------------------------------------------------------------
// Follow system
// ---------------------------------------------------------------------------

const {
  fetchFollowing,
  toggleFollow,
  isFollowing,
  isPending,
  error: followError,
} = useFollows();

// Merge API people with live follow state from the composable.
const people = computed(() =>
  suggestedPeople.value.map((person) => ({
    ...person,
    following: isFollowing(person.userId),
    pending: isPending(person.userId),
  })),
);

// ---------------------------------------------------------------------------
// Filter interaction
// ---------------------------------------------------------------------------

async function selectFilter(
  filter: (typeof PLACE_FILTERS)[number],
): Promise<void> {
  activeFilter.value = filter.label;
  await fetchTrendingPlaces(filter.category);
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

function tripKicker(trip: FeaturedTrip): string {
  return trip.status.charAt(0).toUpperCase() + trip.status.slice(1);
}

function tripAuthorLabel(trip: FeaturedTrip): string {
  return formatHandle(trip.ownerHandle) || (trip.ownerDisplayName ?? "");
}

function guideAuthorLabel(guide: DiscoverGuide): string {
  const handle = formatHandle(guide.ownerHandle);
  if (handle) {
    return `by ${handle}`;
  }
  if (guide.ownerDisplayName) {
    return `by ${guide.ownerDisplayName}`;
  }
  return "by a traveler";
}

function personDisplayName(person: SuggestedPerson): string {
  return person.displayName ?? person.handle ?? DEFAULT_TRAVELER_NAME;
}

function personSubline(person: SuggestedPerson): string {
  const parts: string[] = [];
  if (person.handle) {
    parts.push(formatHandle(person.handle));
  }
  if (person.homeBase) {
    parts.push(person.homeBase);
  }
  if (person.placeCount > 0) {
    parts.push(`${person.placeCount} places`);
  }
  return parts.join(" · ");
}

function formatSaveCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

onMounted(async () => {
  await Promise.all([fetchAll(), fetchFollowing()]);
});
</script>

<style scoped>
.xhero {
  position: relative;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  overflow: hidden;
  padding: 38px 34px;
  margin-bottom: 26px;
  background: var(--surface);
}
.xhero .topo {
  opacity: 0.18;
}
.xhero__in {
  position: relative;
  z-index: 2;
  max-width: 640px;
}
.xhero h1 {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 10px 0 6px;
}
.xhero p {
  font-size: 13px;
  color: var(--ink-2);
  margin: 0 0 20px;
}
.xsearch {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 13px 16px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
  box-shadow: var(--shadow);
}
.xsearch :deep(.ico) {
  width: 18px;
  height: 18px;
  color: var(--muted);
}
.xsearch input {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 14px;
  color: var(--ink);
}
.xsearch input::placeholder {
  color: var(--faint);
}
.xchips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.xchip {
  font-size: 11.5px;
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 99px;
  color: var(--ink-2);
  background: var(--surface-2);
  cursor: pointer;
}
.xchip:hover {
  border-color: var(--accent);
  color: var(--accent-ink);
}

.sec-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin: 0 0 16px;
}
.sec-head h2 {
  font-family: var(--font-display);
  font-size: 20px;
}
.sec-head .label {
  margin-bottom: 6px;
}
section.xsec {
  margin-bottom: 30px;
}

.feat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.feat-row--empty {
  display: block;
}
.feat {
  position: relative;
  height: 250px;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--line);
  display: flex;
  align-items: flex-end;
  text-decoration: none;
}
.feat .topo {
  opacity: 0.5;
}
.feat__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(20, 17, 14, 0.8), transparent 65%);
  z-index: 1;
}
.feat__in {
  position: relative;
  z-index: 2;
  padding: 18px 20px;
  color: #fff;
  width: 100%;
}
.feat__kicker {
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.8);
}
.feat__title {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
  margin: 4px 0 8px;
}
.feat__meta {
  display: flex;
  gap: 14px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.82);
}
.feat__meta span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.feat__meta :deep(.ico) {
  width: 12px;
  height: 12px;
}

.filter-row {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.fbtn {
  font-size: 12px;
  padding: 7px 13px;
  border: 1px solid var(--line-strong);
  border-radius: 99px;
  color: var(--ink-2);
  background: var(--surface);
  cursor: pointer;
}
.fbtn.is-active {
  background: var(--accent-weak);
  color: var(--accent-ink);
  border-color: var(--accent-line);
  font-weight: 600;
}
.place-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.place-grid--empty {
  display: block;
}
.pcard {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  transition:
    border-color 0.14s,
    transform 0.14s;
  text-decoration: none;
  display: block;
}
.pcard:hover {
  border-color: var(--accent-line);
  transform: translateY(-3px);
}
.pcard__cover {
  height: 110px;
  position: relative;
}
.pcard__cover .topo {
  opacity: 0.45;
}
.pcard__tag {
  position: absolute;
  top: 9px;
  left: 9px;
  z-index: 2;
}
.pcard__body {
  padding: 12px 13px 14px;
}
.pcard__name {
  font-family: var(--font-display);
  font-size: 14.5px;
  font-weight: 600;
}
.pcard__loc {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.pcard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 11px;
  font-size: 11px;
  color: var(--faint);
}
.pcard__foot .saves {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.two-col {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 24px;
  align-items: start;
}
.guide {
  display: flex;
  gap: 14px;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  margin-bottom: 12px;
  transition: border-color 0.14s;
  text-decoration: none;
}
.guide:hover {
  border-color: var(--accent-line);
}
.guide__thumb {
  width: 92px;
  height: 72px;
  flex: none;
  border-radius: var(--radius-sm);
}
.guide__name {
  font-family: var(--font-display);
  font-size: 14.5px;
  font-weight: 600;
}
.guide__by {
  font-size: 11px;
  color: var(--muted);
  margin-top: 3px;
}
.guide__meta {
  margin-top: auto;
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--faint);
  padding-top: 8px;
}
.guide__meta .m {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.person {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--line);
}
.person:last-child {
  border-bottom: none;
}
.person__av {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--accent-weak);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  flex: none;
}
.person__name {
  display: block;
  text-decoration: none;
  color: inherit;
}
.person__name b {
  font-size: 13px;
}
.person__name:hover b {
  color: var(--accent-ink);
}
.person__name span {
  font-size: 11px;
  color: var(--muted);
  display: block;
}
.person .btn {
  margin-left: auto;
}

.empty-note {
  font-size: 12.5px;
  color: var(--faint);
  padding: 12px 0;
}

@media (max-width: 1100px) {
  .place-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .feat-row {
    grid-template-columns: 1fr 1fr;
  }
  .two-col {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 680px) {
  .feat-row {
    grid-template-columns: 1fr;
  }
  .place-grid {
    grid-template-columns: 1fr;
  }
}

.xsearch-results {
  margin-top: 12px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.xsearch-group__label {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--faint);
  padding: 9px 14px 4px;
}

.xsearch-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  text-decoration: none;
  color: var(--ink);
  transition: background 0.1s;
}

.xsearch-item:hover {
  background: var(--accent-weak);
}

.xsearch-item :deep(.ico) {
  width: 14px;
  height: 14px;
  color: var(--muted);
  flex: none;
}

.xsearch-item__title {
  font-size: 13px;
  font-weight: 500;
  flex: 1;
}

.xsearch-item__sub {
  font-size: 11px;
  color: var(--muted);
}

.xsearch-empty {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--faint);
}
.xsearch-empty--error {
  color: var(--error, #c0392b);
}
</style>
