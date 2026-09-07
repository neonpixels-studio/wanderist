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
import type { TripStatus } from "~/utils/tripDates";
import { formatTripDateRange } from "~/utils/tripDates";

withDefaults(
  defineProps<{
    trips: ProfileTrip[];
    loading?: boolean;
    errorMessage?: string | null;
    hasMore?: boolean;
  }>(),
  { loading: false, errorMessage: null, hasMore: false },
);

const STATUS_CLASSES: Record<TripStatus, string> = {
  ongoing: "tag--ongoing",
  upcoming: "tag--upcoming",
  past: "tag--past",
};

// The API response isn't statically validated, so a status outside the known
// enum (a future value the frontend hasn't been updated for yet) falls back
// to the neutral "past" styling instead of rendering an unstyled tag.
function tripStatusClass(status: TripStatus): string {
  return STATUS_CLASSES[status] ?? "tag--past";
}

function formatTripDates(trip: ProfileTrip): string {
  return formatTripDateRange(trip.startDate, trip.endDate);
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

/* Scoped (not shared globally): app/pages/trips/index.vue declares the same
   three rules for its own trip cards. Promoting them to a shared class would
   also restyle GuideCard.vue's public/private tag (currently unstyled,
   `.tag--ongoing`/`.tag--past` are applied there with no matching rule) —
   an out-of-scope visual change for this profile-browsing feature, so left as
   a follow-up rather than folded in here. */
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
