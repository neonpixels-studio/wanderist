<template>
  <div class="content">
    <AppTopbar title="Journal" crumb="Home">
      <div class="feed-tabs">
        <button
          v-for="tab in FEED_TABS"
          :key="tab"
          :class="{ 'is-active': activeTab === tab }"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
      </div>
      <button class="btn btn--primary btn--sm" @click="openNewEntry?.()">
        <AppIcon name="plus" :size="14" />
        new entry
      </button>
    </AppTopbar>

    <div class="jcols">
      <!-- Feed -->
      <div class="feed">
        <!-- Compose bar — clicking anywhere opens the new-entry drawer -->
        <div
          class="compose"
          role="button"
          tabindex="0"
          aria-label="Write a new entry"
          @click="openNewEntry?.()"
          @keydown.enter="openNewEntry?.()"
          @keydown.space.prevent="openNewEntry?.()"
        >
          <span class="compose__av">
            <AppIcon name="user" :size="18" />
          </span>
          <input
            readonly
            placeholder="Write an entry, or drop today's photos…"
            @focus="openNewEntry?.()"
          />
          <div class="acts">
            <button
              class="icon-btn"
              aria-label="Add photo"
              @click.stop="openNewEntry?.()"
            >
              <AppIcon name="image" :size="18" />
            </button>
            <button
              class="icon-btn"
              aria-label="Add location"
              @click.stop="openNewEntry?.()"
            >
              <AppIcon name="pin" :size="18" />
            </button>
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="entriesStore.isLoading" class="feed-state">
          <span class="label">// loading…</span>
        </div>

        <!-- Error state -->
        <div v-else-if="entriesStore.error" class="feed-state" role="alert">
          <span class="label">// {{ entriesStore.error }}</span>
        </div>

        <!-- Timeline tab: entries grouped by day -->
        <template v-else-if="activeTab === 'Timeline'">
          <template v-for="group in dayGroups" :key="group.key">
            <div class="day-div">
              <span class="label">// {{ group.label }}</span>
            </div>
            <JournalEntry
              v-for="entry in group.entries"
              :key="entry.id"
              :entry="entry"
              :is-liked="likedEntryIds.has(entry.id)"
              @toggle-like="handleToggleLike"
              @edit="openEditEntry?.($event)"
            />
          </template>
          <div v-if="dayGroups.length === 0" class="feed-state">
            <span class="label">// no entries yet</span>
          </div>
        </template>

        <!-- By trip tab: entries grouped by trip -->
        <template v-else-if="activeTab === 'By trip'">
          <template v-for="group in tripGroups" :key="group.key">
            <div class="day-div">
              <span class="label">// {{ group.tripName }}</span>
            </div>
            <JournalEntry
              v-for="entry in group.entries"
              :key="entry.id"
              :entry="entry"
              :is-liked="likedEntryIds.has(entry.id)"
              @toggle-like="handleToggleLike"
              @edit="openEditEntry?.($event)"
            />
          </template>
          <div v-if="tripGroups.length === 0" class="feed-state">
            <span class="label">// no entries yet</span>
          </div>
        </template>

        <!-- Photos tab: photo grid of entries with media -->
        <template v-else-if="activeTab === 'Photos'">
          <div v-if="photoEntries.length === 0" class="feed-state">
            <span class="label">// no photos yet</span>
          </div>
          <div v-else class="photo-grid">
            <div
              v-for="entry in photoEntries"
              :key="entry.id"
              class="photo-grid__item ph"
            >
              <div class="topo" style="opacity: 0.4" />
              <span class="ph__tag">{{ entry.title }}</span>
            </div>
          </div>
        </template>
      </div>

      <!-- Right rail -->
      <aside class="rail">
        <!-- Active trip card -->
        <div v-if="activeTrip" class="rail-card">
          <h4 class="display">
            Active trip
            <NuxtLink
              class="label label--plain"
              :to="`/trips/${activeTrip.id}`"
              style="font-size: 10px"
              >stats</NuxtLink
            >
          </h4>
          <div
            class="trip-hero ph"
            style="
              height: 90px;
              border-radius: 8px;
              position: relative;
              overflow: hidden;
            "
          >
            <div class="topo" style="opacity: 0.5" />
          </div>
          <div
            style="
              font-family: var(--font-display);
              font-weight: 600;
              font-size: 15px;
              margin-top: 10px;
            "
          >
            {{ activeTrip.name }}
          </div>
          <div
            class="progress"
            style="
              height: 6px;
              border-radius: 99px;
              background: var(--line);
              overflow: hidden;
              margin: 10px 0 6px;
            "
          >
            <span
              :style="{
                display: 'block',
                height: '100%',
                width: activeTripProgressPercent + '%',
                background: 'var(--accent)',
                borderRadius: '99px',
              }"
            />
          </div>
          <div
            class="hstack"
            style="
              justify-content: space-between;
              font-size: 11px;
              color: var(--muted);
            "
          >
            <span>{{ activeTripDayLabel }}</span>
            <span>{{ entryCountLabel(activeTripEntryCount) }}</span>
          </div>
        </div>

        <!-- Trips list -->
        <div class="rail-card">
          <h4 class="display">Trips</h4>
          <div
            v-for="trip in tripsStore.tripList"
            :key="trip.id"
            class="trip-pill"
          >
            <span class="trip-pill__sw" style="background: var(--bg-tint)">
              <span class="topo" style="opacity: 0.6" />
            </span>
            <div>
              <div class="trip-pill__name">{{ trip.name }}</div>
              <div class="trip-pill__sub">{{ formatTripSub(trip) }}</div>
            </div>
          </div>
          <div v-if="tripsStore.tripList.length === 0" class="label">
            // no trips yet
          </div>
        </div>

        <!-- On this day -->
        <div v-if="onThisDayEntries.length > 0" class="rail-card onthisday">
          <h4 class="display">On this day · {{ onThisDayYear }}</h4>
          <div class="ph">
            <div class="topo" style="opacity: 0.4" />
            <span v-if="onThisDayEntries[0]" class="ph__tag">{{
              onThisDayEntries[0].title
            }}</span>
          </div>
          <div class="post__meta" style="font-size: 11px">
            <AppIcon name="pin" :size="11" />
            {{ onThisDayEntries[0]?.title }} —
            {{ onThisDayYearsAgo }}
            {{ onThisDayYearsAgo === 1 ? "year" : "years" }} ago today.
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, toRef, watch } from "vue";
import { useEntriesStore } from "~/stores/entries";
import { useTripsStore } from "~/stores/trips";
import type { Trip } from "~/stores/trips";
import type { Entry, EditEntryHandler } from "~/stores/entries";
import { FEED_TABS, useJournalFeed } from "~/composables/useJournalFeed";

definePageMeta({ layout: "app", middleware: "auth" });
useHead({ title: "Wanderist — Journal" });

const openNewEntry = inject<(() => void) | undefined>(
  "openNewEntry",
  undefined,
);

const openEditEntry = inject<EditEntryHandler | undefined>(
  "openEditEntry",
  undefined,
);

const entriesStore = useEntriesStore();
const tripsStore = useTripsStore();
const { apiFetch } = useApiClient();

const { activeTab, dayGroups, tripGroups, photoEntries } = useJournalFeed(
  toRef(entriesStore, "entries"),
  computed(() => tripsStore.tripList),
);

// "On this day" state
const onThisDayEntries = ref<Entry[]>([]);

const onThisDayYear = computed<number | null>(() => {
  const first = onThisDayEntries.value[0];
  if (!first?.occurredAt) {
    return null;
  }
  return new Date(first.occurredAt).getUTCFullYear();
});

const onThisDayYearsAgo = computed<number>(() => {
  if (!onThisDayYear.value) {
    return 0;
  }
  return new Date().getUTCFullYear() - onThisDayYear.value;
});

// Active trip (the single "ongoing" trip)
const activeTrip = computed<Trip | null>(
  () => tripsStore.tripList.find((trip) => trip.status === "ongoing") ?? null,
);

const activeTripEntryCount = computed<number>(() => {
  if (!activeTrip.value) {
    return 0;
  }
  return entriesStore.entries.filter(
    (entry) => entry.tripId === activeTrip.value!.id,
  ).length;
});

const activeTripProgressPercent = computed<number>(() => {
  const trip = activeTrip.value;
  if (!trip?.startDate || !trip.endDate) {
    return 0;
  }
  const start = new Date(trip.startDate).getTime();
  const end = new Date(trip.endDate).getTime();
  const now = Date.now();
  const total = end - start;
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(((now - start) / total) * 100)));
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const activeTripDayLabel = computed<string>(() => {
  const trip = activeTrip.value;
  if (!trip?.startDate) {
    return "ongoing";
  }
  const start = new Date(trip.startDate).getTime();
  const rawDayNumber = Math.floor((Date.now() - start) / MS_PER_DAY) + 1;

  if (!trip.endDate) {
    return `day ${Math.max(1, rawDayNumber)}`;
  }

  const end = new Date(trip.endDate).getTime();
  const totalDays = Math.ceil((end - start) / MS_PER_DAY);
  const dayNumber = Math.min(Math.max(1, rawDayNumber), totalDays);
  return `day ${dayNumber} of ${totalDays}`;
});

function entryCountLabel(count: number): string {
  return count === 1 ? "1 entry" : `${count} entries`;
}

function formatTripSub(trip: Trip): string {
  const entryCount = entriesStore.entries.filter(
    (entry) => entry.tripId === trip.id,
  ).length;
  return `${entryCountLabel(entryCount)} · ${trip.status}`;
}

// Local set tracking which entry IDs the user has liked. Seeded from the
// server's `likedByCurrentUser` flag (entry_likes join table) on every fetch so
// the heart state survives a reload, then mutated optimistically on toggle.
const likedEntryIds = ref<Set<string>>(new Set());
// IDs whose like/unlike request is in flight. Excluded from seeding so a fetch
// that resolves mid-toggle can't overwrite the user's just-made choice.
const pendingLikeIds = ref<Set<string>>(new Set());

function setLiked(entryId: string, liked: boolean): void {
  if (liked) {
    likedEntryIds.value.add(entryId);
    return;
  }
  likedEntryIds.value.delete(entryId);
}

// Re-sync the liked set from the server's per-row flag on every fetch, in both
// directions (a like removed elsewhere clears here too) — except for IDs with a
// toggle in flight, whose optimistic state must not be clobbered.
function seedLikedEntries(): void {
  for (const entry of entriesStore.entries) {
    if (pendingLikeIds.value.has(entry.id)) {
      continue;
    }
    setLiked(entry.id, entry.likedByCurrentUser === true);
  }
}

async function handleToggleLike(entry: Entry): Promise<void> {
  const wasLiked = likedEntryIds.value.has(entry.id);
  const persist = wasLiked ? entriesStore.unlikeEntry : entriesStore.likeEntry;

  setLiked(entry.id, !wasLiked);
  pendingLikeIds.value.add(entry.id);
  try {
    await persist(entry.id);
  } catch {
    // Rollback optimistic update on failure
    setLiked(entry.id, wasLiked);
  } finally {
    pendingLikeIds.value.delete(entry.id);
  }
}

async function loadOnThisDay(): Promise<void> {
  try {
    const result = await apiFetch<{ entries: Entry[] }>(
      "/api/entries/on-this-day",
    );
    onThisDayEntries.value = Array.isArray(result?.entries)
      ? result.entries
      : [];
  } catch {
    // Non-fatal: "on this day" is optional context. Hide the block on error.
    onThisDayEntries.value = [];
  }
}

// Re-seed whenever the entries list is (re)populated — the initial load, a
// retry, or any refetch — so the heart state always reflects the server.
watch(() => entriesStore.entries, seedLikedEntries);

onMounted(() => {
  // Fetch all three independently and concurrently; failures are non-fatal.
  Promise.allSettled([
    entriesStore
      .fetchEntries()
      .catch((error: unknown) =>
        console.error("[journal] failed to load entries", error),
      ),
    tripsStore
      .fetchTrips()
      .catch((error: unknown) =>
        console.error("[journal] failed to load trips", error),
      ),
    loadOnThisDay(),
  ]);
});
</script>

<style scoped>
.jcols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 296px;
  gap: 28px;
  align-items: start;
  max-width: 960px;
  margin: 0 auto;
}
.feed {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.feed-state {
  padding: 24px 0;
  text-align: center;
}

.compose {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.compose__av {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--accent-weak);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  flex: none;
}
.compose input {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 13.5px;
  color: var(--ink);
}
.compose input::placeholder {
  color: var(--faint);
}
.compose .acts {
  display: flex;
  gap: 6px;
}

.feed-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 99px;
  align-self: flex-start;
}
.feed-tabs button {
  border: none;
  background: none;
  padding: 6px 14px;
  border-radius: 99px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
}
.feed-tabs button.is-active {
  background: var(--accent-weak);
  color: var(--accent-ink);
  font-weight: 600;
}

.post {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.post__head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 14px 16px;
}
.post__av {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--accent-weak);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  flex: none;
}
.post__who b {
  font-size: 13px;
}
.post__meta {
  font-size: 11px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.post__meta :deep(.ico) {
  width: 11px;
  height: 11px;
  color: var(--accent);
}
.post__menu {
  margin-left: auto;
  color: var(--muted);
}
.post__media {
  position: relative;
}
.post__media.single {
  aspect-ratio: 3/2;
}
.post__media.grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 3px;
  aspect-ratio: 3/2;
}
.post__media :deep(.ph) {
  border-radius: 0;
  border-left: none;
  border-right: none;
}
.post__media.single :deep(.ph) {
  width: 100%;
  height: 100%;
  border: none;
}
.post__media.grid :deep(.ph):first-child {
  grid-row: span 2;
}
.more-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 99px;
}
.post__body {
  padding: 14px 16px 16px;
}
.post__actions {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 12px;
}
.post__actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  color: var(--ink-2);
  font-size: 12.5px;
  cursor: pointer;
}
.post__actions button :deep(.ico) {
  width: 17px;
  height: 17px;
}
.post__actions button.liked {
  color: var(--accent-ink);
}
.post__title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 5px;
}
.post__text {
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.6;
  margin: 0 0 10px;
}

.day-div {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 2px;
}
.day-div .label {
  white-space: nowrap;
}
.day-div::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.photo-grid__item {
  aspect-ratio: 1;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.rail {
  position: sticky;
  top: 92px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.rail-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px;
}
.rail-card h4 {
  font-size: 13px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.trip-pill {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.trip-pill:hover {
  background: var(--accent-weak);
}
.trip-pill__sw {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  flex: none;
  position: relative;
  overflow: hidden;
}
.trip-pill__name {
  font-size: 12.5px;
  font-weight: 500;
}
.trip-pill__sub {
  font-size: 10.5px;
  color: var(--muted);
}
.onthisday :deep(.ph) {
  height: 96px;
  margin-bottom: 10px;
}

@media (max-width: 880px) {
  .jcols {
    grid-template-columns: 1fr;
  }
  .rail {
    position: static;
  }
}
</style>
