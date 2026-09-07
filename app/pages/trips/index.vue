<template>
  <div class="content content--wide">
    <div class="trips-head">
      <div>
        <div class="label">
          // {{ tripsStore.tripList.length }} trips · {{ tripsHeaderStats }}
        </div>
        <h1>Your trips</h1>
        <p>One ongoing, two on the calendar, six in the books.</p>
      </div>
      <button class="btn btn--outline" @click="openNewTripForm">
        <AppIcon name="route" :size="15" />
        plan a new route
      </button>
    </div>

    <!-- New trip form -->
    <div
      v-if="showNewTripForm"
      class="new-trip-form"
      role="dialog"
      aria-label="Plan a new route"
    >
      <div class="new-trip-form__title">New trip</div>
      <form class="new-trip-form__row" @submit.prevent="handleCreateTrip">
        <input
          v-model="newTripName"
          class="new-trip-form__input"
          placeholder="Trip name…"
          aria-label="Trip name"
        />
        <button
          type="submit"
          class="btn btn--primary btn--sm"
          :disabled="!newTripName.trim() || isCreatingTrip"
        >
          <AppIcon name="check" :size="14" />
          {{ isCreatingTrip ? "creating…" : "create trip" }}
        </button>
        <button
          type="button"
          class="btn btn--outline btn--sm"
          @click="closeNewTripForm"
        >
          cancel
        </button>
      </form>
      <p v-if="createTripError" class="new-trip-form__error" role="alert">
        {{ createTripError }}
      </p>
    </div>

    <!-- Stats load error -->
    <div
      v-if="statsError"
      class="alert alert--error"
      role="alert"
      style="margin-bottom: 14px"
    >
      {{ statsError }}
    </div>

    <!-- Featured active trip -->
    <div v-if="ongoingTrip" class="feature">
      <NuxtLink class="feature__cover ph" :to="`/trips/${ongoingTrip.id}`">
        <div class="topo" />
        <span class="feature__badge tag tag--ongoing">● ongoing</span>
      </NuxtLink>
      <div class="feature__body">
        <div class="label">// active trip</div>
        <h2 style="margin-top: 8px">{{ ongoingTrip.name }}</h2>
        <div class="feature__stats">
          <div v-if="ongoingTrip.distanceKm != null">
            <div class="n">{{ formatDistance(ongoingTrip.distanceKm) }}</div>
            <div class="l">distance</div>
          </div>
          <div style="margin-left: auto; align-self: center">
            <NuxtLink
              class="btn btn--primary btn--sm"
              :to="`/trips/${ongoingTrip.id}`"
            >
              open trip
              <AppIcon name="arrow-right" :size="14" />
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="trip-toolbar">
      <div class="seg-tabs">
        <button
          v-for="tab in tabs"
          :key="tab"
          :class="{ 'is-active': activeTab === tab }"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
      </div>
      <span class="spacer" />
      <span class="label label--plain" style="font-size: 10px">sort</span>
      <button class="btn btn--outline btn--sm">
        <AppIcon name="sliders" :size="14" />
        recent first
      </button>
    </div>

    <!-- Grid -->
    <div class="trip-grid">
      <NuxtLink
        v-for="trip in filteredTrips"
        :key="trip.id"
        class="tcard"
        :to="`/trips/${trip.id}`"
      >
        <div class="tcard__cover ph">
          <div class="topo" />
          <span class="tcard__status" :class="tripStatusClass(trip.status)">{{
            tripStatusLabel(trip)
          }}</span>
          <button class="tcard__save" aria-label="Save" @click.prevent>
            <AppIcon name="bookmark" :size="15" />
          </button>
        </div>
        <div class="tcard__body">
          <div class="tcard__name">{{ trip.name }}</div>
          <div class="tcard__dates">{{ formatTripDates(trip) }}</div>
          <div class="tcard__foot">
            <span v-if="trip.distanceKm != null" class="m">
              <AppIcon name="pin" :size="13" />
              {{ formatDistance(trip.distanceKm) }}
            </span>
          </div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTripsStore } from "~/stores/trips";
import type { Trip } from "~/stores/trips";
import { formatCompact } from "~/utils/formatNumber";
import { useStats } from "~/composables/useStats";
import { formatTripDateRange } from "~/utils/tripDates";
import type { TripStatus } from "~/utils/tripDates";

definePageMeta({ layout: "app", middleware: "auth" });
useHead({ title: "Wanderist — Trips" });

const STATUS_CLASSES: Record<TripStatus, string> = {
  ongoing: "tag tag--ongoing",
  upcoming: "tag tag--upcoming",
  past: "tag tag--past",
};

const tabs = ["All", "Ongoing", "Upcoming", "Past"] as const;
const activeTab = ref<(typeof tabs)[number]>("All");

const tripsStore = useTripsStore();
const {
  stats,
  displayDistance,
  loadError: statsError,
  fetchStats,
} = useStats();

const distanceUnitShort = computed(() =>
  stats.value.distanceUnit === "km" ? "km" : "miles",
);

const tripsHeaderStats = computed(
  () =>
    `${formatCompact(stats.value.placesCount)} places · ${formatCompact(displayDistance.value)} ${distanceUnitShort.value}`,
);

onMounted(() => {
  fetchStats();
  // listError is set in the store on failure; TODO surface it in the UI
  // once an error/empty-state design is available (tracked in issue #17 or
  // wherever the trips-page visual design lands).
  tripsStore.fetchTrips().catch((error) => {
    console.error("[trips] failed to load trips on mount", error);
  });
});

const ongoingTrip = computed<Trip | null>(
  () => tripsStore.tripList.find((trip) => trip.status === "ongoing") ?? null,
);

const showNewTripForm = ref(false);
const newTripName = ref("");
const isCreatingTrip = ref(false);
const createTripError = ref<string | null>(null);

function openNewTripForm(): void {
  newTripName.value = "";
  createTripError.value = null;
  showNewTripForm.value = true;
}

function closeNewTripForm(): void {
  showNewTripForm.value = false;
}

async function handleCreateTrip(): Promise<void> {
  const name = newTripName.value.trim();
  if (!name) {
    return;
  }

  isCreatingTrip.value = true;
  createTripError.value = null;

  try {
    await tripsStore.createTrip({ name });
    closeNewTripForm();
  } catch (error) {
    createTripError.value =
      error instanceof Error ? error.message : "Failed to create trip";
  } finally {
    isCreatingTrip.value = false;
  }
}

const filteredTrips = computed<Trip[]>(() => {
  if (activeTab.value === "All") {
    return tripsStore.tripList;
  }

  const statusFilter = activeTab.value.toLowerCase() as TripStatus;
  return tripsStore.tripList.filter((trip) => trip.status === statusFilter);
});

function tripStatusClass(status: TripStatus) {
  return STATUS_CLASSES[status];
}

function tripStatusLabel(trip: Trip) {
  if (!trip.startDate) {
    return trip.status;
  }

  return new Date(trip.startDate).getUTCFullYear().toString();
}

function formatTripDates(trip: Trip): string {
  return formatTripDateRange(trip.startDate, trip.endDate);
}

function formatDistance(distanceKm: number): string {
  return `${distanceKm.toFixed(0)} km`;
}
</script>

<style scoped>
.trips-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}
.trips-head h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-top: 10px;
}
.trips-head p {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}

.new-trip-form {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--surface);
  padding: 16px;
  margin-bottom: 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.new-trip-form__title {
  font-size: 14px;
  font-weight: 600;
}
.new-trip-form__row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.new-trip-form__input {
  flex: 1;
  min-width: 200px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  padding: 8px 10px;
  font-size: 13px;
  color: var(--ink);
  outline: none;
}
.new-trip-form__input:focus {
  border-color: var(--accent-line);
}
.new-trip-form__error {
  font-size: 12px;
  color: var(--error, #c0392b);
}

.feature {
  display: grid;
  grid-template-columns: 300px 1fr;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface);
  margin-bottom: 26px;
}
.feature__cover {
  position: relative;
  min-height: 220px;
}
.feature__cover .topo {
  opacity: 0.5;
}
.feature__badge {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 2;
}
.feature__body {
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
}
.feature__body h2 {
  font-size: 23px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.feature__route {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0;
  font-size: 12px;
  color: var(--ink-2);
}
.feature__route .stop {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.feature__route .stop .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}
.feature__route .arr {
  color: var(--faint);
}
.feature__stats {
  display: flex;
  gap: 28px;
  padding: 16px 0;
  border-top: 1px solid var(--line);
  margin-top: auto;
}
.feature__stats .n {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
}
.feature__stats .l {
  font-size: 10.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.feature__prog {
  margin: 4px 0 18px;
}

.trip-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.trip-toolbar .spacer {
  flex: 1;
}

.trip-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.tcard {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  transition:
    border-color 0.14s,
    transform 0.14s,
    box-shadow 0.14s;
}
.tcard:hover {
  border-color: var(--accent-line);
  transform: translateY(-3px);
  box-shadow: var(--shadow);
}
.tcard__cover {
  position: relative;
  height: 132px;
}
.tcard__cover .topo {
  opacity: 0.45;
}
.tcard__status {
  position: absolute;
  top: 11px;
  left: 11px;
  z-index: 2;
}
.tcard__save {
  position: absolute;
  top: 9px;
  right: 9px;
  z-index: 2;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 80%, transparent);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--ink-2);
}
.tcard__save:hover {
  color: var(--accent-ink);
}
.tcard__body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
}
.tcard__name {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
}
.tcard__dates {
  font-size: 11.5px;
  color: var(--muted);
  margin-top: 3px;
}
.tcard__foot {
  display: flex;
  gap: 16px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.tcard__foot .m {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--ink-2);
}
.tcard__prog {
  height: 5px;
  border-radius: 99px;
  background: var(--line);
  overflow: hidden;
  margin-top: 13px;
}
.tcard__prog span {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 99px;
}

.tag--ongoing {
  border-color: var(--success-ink);
  color: var(--success-ink);
  background: var(--success-weak);
}
.tag--upcoming {
  border-color: var(--info-ink);
  color: var(--info-ink);
  background: var(--info-weak);
}
.tag--past {
  border-color: var(--line-strong);
  color: var(--muted);
}

@media (max-width: 1040px) {
  .trip-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .feature {
    grid-template-columns: 1fr;
  }
  .feature__cover {
    min-height: 160px;
  }
}
@media (max-width: 680px) {
  .trip-grid {
    grid-template-columns: 1fr;
  }
}
</style>
