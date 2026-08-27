<template>
  <div v-if="isLoading" class="content content--wide" style="padding-top: 0">
    <div class="loading-state">Loading trip…</div>
  </div>

  <div
    v-else-if="!tripDetail"
    class="content content--wide"
    style="padding-top: 0"
  >
    <div class="empty-state">
      Trip not found.
      <NuxtLink
        v-if="isClerkLoaded && !isSignedIn"
        to="/login"
        class="empty-state__signin"
      >
        Sign in to view your trips
      </NuxtLink>
    </div>
  </div>

  <div v-else class="content content--wide" style="padding-top: 0">
    <!-- Hero -->
    <div
      class="thero ph"
      :style="
        pendingCoverUrl
          ? `background-image: url('${encodeURI(pendingCoverUrl)}')`
          : ''
      "
      :class="{ 'thero--has-cover': !!pendingCoverUrl }"
    >
      <div class="topo" />
      <div class="thero__veil" />
      <div v-if="isOwner" class="thero__acts">
        <button
          class="btn btn--outline btn--sm"
          style="
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.4);
            color: #fff;
          "
          :disabled="isUploadingCover"
          @click="onEditCover"
        >
          <AppIcon name="image" :size="14" />
          {{ isUploadingCover ? "uploading…" : "edit cover" }}
        </button>
        <input
          ref="coverInputRef"
          type="file"
          accept="image/*"
          style="display: none"
          @change="onCoverFileSelected"
        />
        <button
          class="btn btn--outline btn--sm"
          style="
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.4);
            color: #fff;
          "
          @click="onShare"
        >
          <AppIcon name="globe" :size="14" />
          {{
            tripDetail.trip.visibility === "public" ? "public link" : "share"
          }}
        </button>
      </div>
      <div class="thero__in">
        <div class="label">// {{ heroLabel }}</div>
        <h1>{{ tripDetail.trip.name }}</h1>
        <div class="thero__meta">
          <span v-if="tripDetail.trip.startDate">
            <AppIcon name="calendar" :size="14" />
            {{ formatHeroDates(tripDetail.trip) }}
          </span>
          <span>
            <AppIcon name="pin" :size="14" />
            {{ tripDetail.facts.stopCount }}
            {{ tripDetail.facts.stopCount === 1 ? "stop" : "stops" }}
            <template v-if="tripDetail.facts.distanceKm != null">
              · {{ formatKm(tripDetail.facts.distanceKm) }}
            </template>
          </span>
          <span>
            <AppIcon name="image" :size="14" />
            {{ tripDetail.facts.photoCount }}
            {{ tripDetail.facts.photoCount === 1 ? "photo" : "photos" }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="uploadError" class="alert alert--error" style="margin: 12px 0">
      {{ uploadError }}
    </div>

    <div v-if="shareError" class="alert alert--error" style="margin: 12px 0">
      {{ shareError }}
    </div>

    <div class="tdcols">
      <!-- Itinerary -->
      <div>
        <div class="iti-head">
          <div>
            <div class="label">// itinerary</div>
            <h2 class="display" style="font-size: 20px; margin-top: 8px">
              Route &amp; stops
            </h2>
          </div>
          <button
            v-if="isOwner"
            class="btn btn--ghost btn--sm"
            :disabled="sortedStops.length < 2"
            @click="onReorder"
          >
            <AppIcon name="sliders" :size="14" />
            reorder
          </button>
        </div>

        <div class="iti">
          <div
            v-for="stop in sortedStops"
            :key="stop.id"
            class="stop"
            :class="stopStateClass(stop.status)"
          >
            <div class="stop__node">
              <div class="stop__pin">
                <AppIcon
                  v-if="stop.status === 'done'"
                  name="check"
                  :size="18"
                />
                <AppIcon
                  v-else-if="stop.status === 'next'"
                  name="pin"
                  :size="18"
                />
                <span v-else>{{ stopDisplayNumber(stop) }}</span>
              </div>
            </div>
            <div class="stop__card">
              <div class="stop__top">
                <div>
                  <div class="stop__name">{{ stop.name }}</div>
                  <div class="stop__sub">
                    <template v-if="stop.arriveDate">
                      <AppIcon name="calendar" :size="12" />
                      {{ formatStopDate(stop.arriveDate) }}
                      <template v-if="stop.nights != null">
                        · {{ stop.nights }}
                        {{ stop.nights === 1 ? "night" : "nights" }}
                      </template>
                    </template>
                    <span v-if="stop.status === 'next'" class="tag tag--accent"
                      >next</span
                    >
                  </div>
                </div>
                <span v-if="isOwner" class="stop__grip">
                  <AppIcon name="grip" :size="16" />
                </span>
              </div>
              <p v-if="stop.note" class="stop__note">{{ stop.note }}</p>
              <div class="stop__foot">
                <span v-if="stop.distanceKm != null" class="m">
                  <AppIcon name="ruler" :size="12" />
                  {{ formatKm(stop.distanceKm) }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="isOwner" class="stop__add">
            <div />
            <button class="add-btn" :disabled="isAddingStop" @click="onAddStop">
              <AppIcon name="plus" :size="15" />
              {{ isAddingStop ? "adding…" : "add a stop" }}
            </button>
          </div>
        </div>

        <div
          v-if="addStopError"
          class="alert alert--error"
          style="margin-top: 8px"
        >
          {{ addStopError }}
        </div>

        <div
          v-if="reorderError"
          class="alert alert--error"
          style="margin-top: 8px"
        >
          {{ reorderError }}
        </div>
      </div>

      <!-- Rail -->
      <aside class="trail">
        <div class="rail-card" style="padding: 0; overflow: hidden">
          <div class="mini-map">
            <div class="topo" />
            <span
              v-for="(stop, index) in mapPins"
              :key="stop.id"
              class="pin-abs"
              :style="mapPinStyle(index, mapPins.length)"
            >
              <AppIcon name="pin" :size="18" class="pin" />
            </span>
          </div>
          <div style="padding: 13px 16px">
            <NuxtLink class="btn btn--outline btn--sm btn--block" to="/map">
              <AppIcon name="map" :size="14" />
              open in full map
            </NuxtLink>
          </div>
        </div>

        <div class="rail-card">
          <h4 class="display">Trip facts</h4>
          <div class="fact">
            <span class="k">Status</span>
            <span class="v" :style="statusStyle">{{ statusLabel }}</span>
          </div>
          <div v-if="tripDetail.facts.distanceKm != null" class="fact">
            <span class="k">Distance</span>
            <span class="v">{{ formatKm(tripDetail.facts.distanceKm) }}</span>
          </div>
          <div
            v-if="
              tripDetail.facts.loggedDistanceKm != null &&
              tripDetail.facts.distanceKm != null
            "
            class="fact"
          >
            <span class="k">Logged</span>
            <span class="v">
              {{ formatKm(tripDetail.facts.loggedDistanceKm) }} /
              {{ formatKm(tripDetail.facts.distanceKm) }}
            </span>
          </div>
          <div v-if="tripDetail.facts.nights != null" class="fact">
            <span class="k">Nights</span>
            <span class="v">{{ tripDetail.facts.nights }}</span>
          </div>
          <div class="fact">
            <span class="k">Photos</span>
            <span class="v">{{ tripDetail.facts.photoCount }}</span>
          </div>
          <div class="fact">
            <span class="k">Visibility</span>
            <span class="v">{{
              tripDetail.trip.visibility === "public" ? "Public" : "Private"
            }}</span>
          </div>
        </div>

        <div v-if="isOwner" class="rail-card">
          <h4
            class="display"
            style="
              display: flex;
              align-items: center;
              justify-content: space-between;
            "
          >
            Travelling with
            <button
              class="label label--plain"
              style="
                font-size: 10px;
                border: none;
                background: none;
                color: var(--accent-ink);
              "
              @click="onInvite"
            >
              invite
            </button>
          </h4>
          <div class="companions">
            <div class="companion">
              <span
                class="companion__av"
                style="background: var(--bg-tint); color: var(--muted)"
              >
                <AppIcon name="plus" :size="16" />
              </span>
              <div>
                <b>Invite someone</b><br /><span>add a co-traveller</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTripsStore } from "~/stores/trips";
import type { Trip, TripStop } from "~/stores/trips";
import { useMediaUpload } from "~/composables/useMediaUpload";

// No auth middleware: a public trip must open for anonymous visitors following
// a shared link. The GET endpoint enforces visibility — a private trip returns
// 404, which this page renders as its not-found state (it never redirects to
// /login), so private trips stay protected. Owner-only controls below are gated
// on isOwner, so a non-owner viewer gets a read-only page.
definePageMeta({ layout: "app" });

const route = useRoute();
const tripId = computed(() => String(route.params.id));

const tripsStore = useTripsStore();
const { user: clerkUser } = useClerkUser();
// isLoaded gates the read-only/owner split: until Clerk resolves, clerkUser is
// null and every viewer would look like a non-owner, flashing the owner the
// read-only page. isSignedIn drives the sign-in affordance in the not-found
// state so a signed-out owner arriving from a bookmark/expired session isn't
// dead-ended.
const { isLoaded: isClerkLoaded, isSignedIn } = useClerkAuth();
const {
  upload,
  isUploading: isUploadingCover,
  error: mediaError,
} = useMediaUpload();

const isAddingStop = ref(false);
const addStopError = ref<string | null>(null);
const reorderError = ref<string | null>(null);
const uploadError = ref<string | null>(null);
const shareError = ref<string | null>(null);
const coverInputRef = ref<HTMLInputElement | null>(null);

// Guard against the render window during in-page navigation (trip-1 -> trip-2):
// the route id updates reactively before the refetch flips isLoadingDetail, so
// only show the loaded detail once it actually matches the id in the URL.
const tripDetail = computed(() =>
  tripsStore.currentTripDetail?.trip.id === tripId.value
    ? tripsStore.currentTripDetail
    : null,
);

// A non-owner (including an anonymous visitor) viewing a public trip gets a
// read-only page: every mutating/owner-only control below is gated on this.
// Guarded on isClerkLoaded so the owner is never misread as a non-owner while
// Clerk is still bootstrapping — until it resolves, clerkUser is null and this
// stays false (read-only), then flips true once the real owner is known.
const isOwner = computed(
  () =>
    isClerkLoaded.value &&
    !!tripDetail.value &&
    !!clerkUser.value &&
    clerkUser.value.id === tripDetail.value.trip.userId,
);

// `server: false` keeps the fetch client-only, mirroring guides/[id].vue and
// u/[id].vue: the request carries the Clerk session token, which only exists on
// the client (Clerk runs with skipServerMiddleware). Running it during SSR would
// hang, since Clerk's getToken never resolves on the server.
//
// Watch isClerkLoaded as well as the id: the first pass can run before Clerk is
// ready, sending an anonymous request that 404s the owner's own private trip.
// Re-running once Clerk resolves re-issues the request with a token so the owner
// gets their private trip; a public trip already resolved on the anonymous pass.
const { status: fetchStatus } = useAsyncData(
  () => `trip-detail-${tripId.value}`,
  () => tripsStore.fetchTripById(tripId.value),
  { server: false, watch: [tripId, isClerkLoaded] },
);

// Until the client fetch resolves, the SSR pass and hydration frame have no trip
// yet. Treat that window as loading so a valid trip never flashes "Trip not
// found" before its data arrives. This is deliberately NOT gated on
// isClerkLoaded: an anonymous visitor following a shared link needs nothing from
// Clerk, so if the Clerk script is blocked the page still renders the public
// trip read-only rather than hanging on "Loading trip…" forever.
const hasResolvedFetch = computed(
  () => fetchStatus.value === "success" || fetchStatus.value === "error",
);
const isLoading = computed(
  () => tripsStore.isLoadingDetail || !hasResolvedFetch.value,
);

useHead(
  computed(() => ({
    title: tripDetail.value
      ? `Wanderist — ${tripDetail.value.trip.name}`
      : "Wanderist — Trip",
  })),
);

const sortedStops = computed<TripStop[]>(() => {
  if (!tripDetail.value) {
    return [];
  }
  return [...tripDetail.value.stops].sort(
    (stopA, stopB) => stopA.sortOrder - stopB.sortOrder,
  );
});

// Cap at 6 stops to fit the mini-map without overlapping pins
const mapPins = computed<TripStop[]>(() => sortedStops.value.slice(0, 6));

// pendingCoverUrl holds the optimistically cached URL after a successful cover
// upload so the hero displays immediately without a round-trip to re-fetch the trip.
// Set only after both the upload AND the patchTrip calls succeed so the visible
// state never diverges from the persisted state.
const pendingCoverUrl = ref<string | null>(null);

const STATUS_STYLE_MAP: Record<Trip["status"], string> = {
  ongoing: "color: var(--success-ink)",
  upcoming: "color: var(--info-ink)",
  past: "",
};

const STATUS_LABEL_MAP: Record<Trip["status"], string> = {
  ongoing: "Ongoing",
  upcoming: "Upcoming",
  past: "Past",
};

const statusStyle = computed<string>(() => {
  const status = tripDetail.value?.trip.status ?? "past";
  return STATUS_STYLE_MAP[status];
});

const statusLabel = computed<string>(() => {
  const status = tripDetail.value?.trip.status ?? "past";
  return STATUS_LABEL_MAP[status];
});

const heroLabel = computed<string>(() => {
  const status = tripDetail.value?.trip.status;
  if (status === "ongoing") {
    return "ongoing trip";
  }
  if (status === "upcoming") {
    return "upcoming trip";
  }
  return "past trip";
});

const STOP_STATE_CLASSES: Record<TripStop["status"], string> = {
  done: "is-done",
  next: "is-next",
  planned: "",
};

function stopStateClass(status: TripStop["status"]): string {
  return STOP_STATE_CLASSES[status];
}

function stopDisplayNumber(stop: TripStop): number {
  const index = sortedStops.value.findIndex(
    (candidateStop) => candidateStop.id === stop.id,
  );
  return index + 1;
}

const UTC_DATE_FORMAT = {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
} as const;

function formatHeroDates(
  trip: NonNullable<typeof tripDetail.value>["trip"],
): string {
  if (!trip.startDate) {
    return "";
  }

  const start = new Date(trip.startDate);
  const startStr = start.toLocaleDateString("en-US", UTC_DATE_FORMAT);

  if (!trip.endDate) {
    return startStr;
  }

  const end = new Date(trip.endDate);
  const endStr = end.toLocaleDateString("en-US", UTC_DATE_FORMAT);

  return `${startStr} – ${endStr}`;
}

function formatStopDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", UTC_DATE_FORMAT);
}

function formatKm(km: number): string {
  return `${km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
}

function mapPinStyle(index: number, total: number): string {
  if (total === 0) {
    return "";
  }
  // Spread pins across the mini-map in a simple arc pattern
  const leftPercent = 20 + (60 / Math.max(total - 1, 1)) * index;
  const topPercent = 30 + Math.sin((index / total) * Math.PI) * 40;
  return `left: ${leftPercent.toFixed(0)}%; top: ${topPercent.toFixed(0)}%`;
}

async function onAddStop(): Promise<void> {
  if (!tripId.value) {
    return;
  }

  isAddingStop.value = true;
  addStopError.value = null;

  try {
    await tripsStore.createStop(tripId.value, {
      name: "New stop",
      status: "planned",
    });
  } catch (error) {
    addStopError.value =
      error instanceof Error ? error.message : "Failed to add stop";
  } finally {
    isAddingStop.value = false;
  }
}

async function onReorder(): Promise<void> {
  if (!tripId.value || sortedStops.value.length < 2) {
    return;
  }

  reorderError.value = null;

  try {
    // Reorder is a drag operation in the full UI; for now the button persists
    // the current visual order to the server (no-op if already ordered,
    // but wires the endpoint so drag-and-drop can call reorderStops directly).
    const stopIds = sortedStops.value.map((stop) => stop.id);
    await tripsStore.reorderStops(tripId.value, stopIds);
  } catch (error) {
    reorderError.value =
      error instanceof Error ? error.message : "Failed to reorder stops";
  }
}

function onEditCover(): void {
  coverInputRef.value?.click();
}

async function onCoverFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  uploadError.value = null;

  try {
    const result = await upload(file);
    try {
      await tripsStore.patchTrip(tripId.value, { coverImageId: result.id });
    } catch (patchError) {
      // The file uploaded but the trip could not be updated; the media is now
      // orphaned server-side. Surface the specific error so the user knows
      // the cover change did not persist (note: media cleanup is not implemented).
      uploadError.value =
        patchError instanceof Error
          ? patchError.message
          : "Cover uploaded but could not be saved to the trip";
      return;
    }
    // Set after both steps succeed so the displayed cover matches persisted state
    pendingCoverUrl.value = result.url;
  } catch {
    uploadError.value = mediaError.value ?? "Could not upload cover";
  } finally {
    // Reset input so selecting the same file fires change again
    input.value = "";
  }
}

async function copyPublicLink(tripIdToShare: string): Promise<void> {
  const publicUrl = `${window.location.origin}/trips/${tripIdToShare}`;
  try {
    await navigator.clipboard.writeText(publicUrl);
  } catch {
    shareError.value = `Could not copy. Share this link manually: ${publicUrl}`;
  }
}

async function onShare(): Promise<void> {
  if (!tripDetail.value) {
    return;
  }

  const trip = tripDetail.value.trip;
  shareError.value = null;

  if (trip.visibility === "public") {
    await copyPublicLink(trip.id);
    return;
  }

  // Making a trip public is irreversible from this UI — confirm before proceeding.
  // The button label changes to "public link" once public, so a second click copies.
  const confirmed = window.confirm(
    "Make this trip public? Anyone with the link will be able to view it.",
  );

  if (!confirmed) {
    return;
  }

  try {
    await tripsStore.patchTrip(tripId.value, { visibility: "public" });
  } catch (error) {
    shareError.value =
      error instanceof Error ? error.message : "Failed to update visibility";
    return;
  }

  await copyPublicLink(trip.id);
}

function onInvite(): void {
  // Companion invite requires a collaborator/follow-system endpoint that is
  // not yet exposed via the current API surface. This is a no-op placeholder;
  // the follow system (useFollows) handles user follows but not trip-level
  // collaborator invitations. Tracked for a future API endpoint addition.
}
</script>

<style scoped>
.loading-state,
.empty-state {
  padding: 60px 0;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}
.empty-state__signin {
  display: inline-block;
  margin-top: 10px;
  color: var(--accent-ink);
  text-decoration: none;
}
.empty-state__signin:hover {
  text-decoration: underline;
}

.thero {
  position: relative;
  height: 280px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--line);
  margin: 22px 0 24px;
  display: flex;
  align-items: flex-end;
  background-size: cover;
  background-position: center;
}
.thero .topo {
  opacity: 0.5;
}
.thero--has-cover .topo {
  display: none;
}
.thero__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgba(20, 17, 14, 0.78),
    rgba(20, 17, 14, 0.1) 60%,
    transparent
  );
  z-index: 1;
}
.thero__in {
  position: relative;
  z-index: 2;
  padding: 26px 28px;
  color: #fff;
  width: 100%;
}
.thero__in .label {
  color: #fff;
}
.thero__in :deep(.label::before) {
  background: #fff;
}
.thero h1 {
  color: #fff;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 8px 0 10px;
}
.thero__meta {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.85);
}
.thero__meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.thero__acts {
  position: absolute;
  top: 18px;
  right: 20px;
  z-index: 2;
  display: flex;
  gap: 8px;
}

.tdcols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 28px;
  align-items: start;
}

.iti-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.iti {
  position: relative;
}
.iti::before {
  content: "";
  position: absolute;
  left: 19px;
  top: 8px;
  bottom: 40px;
  width: 2px;
  background: var(--line);
}
.stop {
  position: relative;
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 14px;
  margin-bottom: 16px;
}
.stop__node {
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stop__pin {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--line-strong);
  display: grid;
  place-items: center;
  color: var(--muted);
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 14px;
  z-index: 1;
}
.stop.is-done .stop__pin {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.stop.is-next .stop__pin {
  border-color: var(--accent);
  color: var(--accent-ink);
  box-shadow: 0 0 0 4px var(--accent-weak);
}
.stop__card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 15px 17px;
}
.stop.is-next .stop__card {
  border-color: var(--accent-line);
}
.stop__top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.stop__name {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
}
.stop__sub {
  font-size: 11.5px;
  color: var(--muted);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.stop__grip {
  margin-left: auto;
  color: var(--faint);
  cursor: grab;
}
.stop__note {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.55;
  margin: 10px 0 0;
}
.stop__foot {
  display: flex;
  gap: 14px;
  margin-top: 11px;
  padding-top: 11px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
}
.stop__foot .m {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.stop__add {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 14px;
}
.stop__add .add-btn {
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  padding: 13px;
  background: none;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.stop__add .add-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-ink);
}
.stop__add .add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.trail {
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
}
.mini-map {
  height: 180px;
  border-radius: var(--radius-sm);
  position: relative;
  overflow: hidden;
  margin: -2px 0 0;
  border: 1px solid var(--line);
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0 23px,
      color-mix(in srgb, var(--line) 60%, transparent) 23px 24px
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 23px,
      color-mix(in srgb, var(--line) 60%, transparent) 23px 24px
    ),
    var(--bg-tint);
}
.mini-map .topo {
  opacity: 0.4;
}
.mini-map .pin-abs {
  position: absolute;
  transform: translate(-50%, -100%);
}
.fact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 12.5px;
}
.fact:last-child {
  border-bottom: none;
}
.fact .k {
  color: var(--muted);
}
.fact .v {
  font-weight: 600;
}
.companions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.companion {
  display: flex;
  align-items: center;
  gap: 11px;
}
.companion__av {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-weak);
  color: var(--accent-ink);
  display: grid;
  place-items: center;
  flex: none;
}
.companion b {
  font-size: 12.5px;
}
.companion span {
  font-size: 11px;
  color: var(--muted);
}

.alert--error {
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--error-weak, #fee2e2);
  color: var(--error-ink, #b91c1c);
  font-size: 12.5px;
}

@media (max-width: 920px) {
  .tdcols {
    grid-template-columns: 1fr;
  }
  .trail {
    position: static;
  }
}
</style>
