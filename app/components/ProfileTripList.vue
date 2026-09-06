<template>
  <!-- Not dismissible: this is the section's only content when it errors, so
       dismissing it would leave the section blank with no way to recover. -->
  <AppAlert v-if="errorMessage" intent="error" :message="errorMessage" />
  <!-- Only show the loading note when there is nothing yet; a refresh keeps
       the existing list visible rather than flashing back to this line. -->
  <p v-else-if="loading && !trips.length" class="empty-note">Loading trips…</p>
  <div v-else-if="trips.length" class="card card--pad">
    <NuxtLink
      v-for="trip in trips"
      :key="trip.id"
      class="trip"
      :to="`/trips/${encodeURIComponent(trip.id)}`"
    >
      <span class="trip__av">
        <AppIcon name="route" :size="18" />
      </span>
      <div class="trip__body">
        <b>{{ trip.name }}</b>
        <span>{{ formatTripDates(trip) }}</span>
      </div>
      <span class="tag" :class="tripStatusClass(trip.status)">{{
        trip.status
      }}</span>
    </NuxtLink>
    <p v-if="hasMore" class="trips-more">
      Showing the {{ trips.length }} most recent public trips.
    </p>
  </div>
  <p v-else class="empty-note">No public trips yet.</p>
</template>

<script setup lang="ts">
import type { ProfileTrip } from "~/composables/useProfile";

withDefaults(
  defineProps<{
    trips: ProfileTrip[];
    loading?: boolean;
    errorMessage?: string | null;
    hasMore?: boolean;
  }>(),
  { loading: false, errorMessage: null, hasMore: false },
);

const STATUS_CLASSES: Record<string, string> = {
  ongoing: "tag--ongoing",
  upcoming: "tag--upcoming",
  past: "tag--past",
};

const UTC_DATE_FORMAT = {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
} as const;

function tripStatusClass(status: string): string {
  return STATUS_CLASSES[status] ?? "tag--past";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Mirrors the display convention trips/index.vue uses for its trip cards
// (date range + day count) so the same trip reads identically wherever it
// appears.
function formatTripDates(trip: ProfileTrip): string {
  if (!trip.startDate) {
    return "dates TBD";
  }

  const start = new Date(trip.startDate);
  const startLabel = start.toLocaleDateString("en-US", UTC_DATE_FORMAT);

  if (!trip.endDate) {
    return startLabel;
  }

  const end = new Date(trip.endDate);
  const endLabel = end.toLocaleDateString("en-US", UTC_DATE_FORMAT);
  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);

  return `${startLabel} – ${endLabel} · ${days} days`;
}
</script>

<style scoped>
.trip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--line);
  text-decoration: none;
  color: inherit;
}
.trip:last-child {
  border-bottom: none;
}
.trip__av {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--accent-weak);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  flex: none;
}
.trip__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.trip__body b {
  font-size: 13px;
}
.trip:hover .trip__body b {
  color: var(--accent-ink);
}
.trip__body span {
  font-size: 11px;
  color: var(--muted);
  display: block;
}

.empty-note {
  font-size: 12.5px;
  color: var(--faint);
  padding: 12px 0;
}

.trips-more {
  font-size: 11.5px;
  color: var(--faint);
  padding: 12px 2px 2px;
  text-align: center;
}
</style>
