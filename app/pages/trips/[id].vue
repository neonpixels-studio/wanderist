<template>
  <div v-if="isLoading" class="content content--wide" style="padding-top: 0">
    <div class="loading-state">Loading trip…</div>
  </div>

  <div
    v-else-if="!tripDetail && detailLoadError"
    class="content content--wide"
    style="padding-top: 0"
  >
    <div class="empty-state">
      <AppAlert intent="error" :message="detailLoadError" />
      <button
        class="btn btn--outline btn--sm empty-state__retry"
        @click="onRetryLoad"
      >
        try again
      </button>
      <NuxtLink to="/trips" class="empty-state__back">
        back to your trips
      </NuxtLink>
      <NuxtLink
        v-if="isClerkLoaded && !isSignedIn"
        to="/login"
        class="empty-state__signin"
      >
        Sign in to view your trips
      </NuxtLink>
    </div>
  </div>

  <!-- Reached whenever nothing loaded and the branch above didn't already
       claim it: the store never sets detailError while classifying a fetch
       as not-found (see fetchTripById in stores/trips.ts), so tripDetail
       null + no detailLoadError always means detailNotFound (or the fetch
       simply hasn't resolved with a trip yet). -->
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

    <div
      v-if="detailLoadError"
      class="alert alert--error"
      style="margin: 12px 0"
    >
      Couldn't refresh this trip: {{ detailLoadError }}
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
        </div>

        <div class="iti">
          <ul class="iti__list">
            <li
              v-for="stop in displayedStops"
              :key="stop.id"
              class="stop"
              :class="[
                stopStateClass(stop.status),
                {
                  'stop--dragging': draggedStopId === stop.id,
                  'stop--drag-over':
                    dragOverStopId === stop.id && draggedStopId !== stop.id,
                },
              ]"
              :draggable="isOwner && !isReordering"
              @dragstart="onStopDragStart(stop, $event)"
              @dragover="onStopDragOver(stop, $event)"
              @dragleave="onStopDragLeave(stop, $event)"
              @drop="onStopDrop(stop, $event)"
              @dragend="onStopDragEnd"
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
                      <span
                        v-if="stop.status === 'next'"
                        class="tag tag--accent"
                        >next</span
                      >
                    </div>
                  </div>
                  <div v-if="isOwner" class="stop__reorder">
                    <button
                      type="button"
                      class="stop__move-btn"
                      :aria-label="`Move ${stop.name} up`"
                      :disabled="isFirstStop(stop)"
                      @click="onMoveStopUp(stop, $event)"
                    >
                      <AppIcon name="arrow-up" :size="14" />
                    </button>
                    <button
                      type="button"
                      class="stop__move-btn"
                      :aria-label="`Move ${stop.name} down`"
                      :disabled="isLastStop(stop)"
                      @click="onMoveStopDown(stop, $event)"
                    >
                      <AppIcon name="arrow-down" :size="14" />
                    </button>
                    <span class="stop__grip" aria-hidden="true">
                      <AppIcon name="grip" :size="16" />
                    </span>
                  </div>
                </div>
                <p v-if="stop.note" class="stop__note">{{ stop.note }}</p>
                <div class="stop__foot">
                  <span v-if="stop.distanceKm != null" class="m">
                    <AppIcon name="ruler" :size="12" />
                    {{ formatKm(stop.distanceKm) }}
                  </span>
                </div>
              </div>
            </li>
          </ul>

          <div v-if="isOwner" class="stop__add">
            <div />
            <button class="add-btn" :disabled="isAddingStop" @click="onAddStop">
              <AppIcon name="plus" :size="15" />
              {{ isAddingStop ? "adding…" : "add a stop" }}
            </button>
          </div>

          <p class="visually-hidden" role="status" aria-live="polite">
            {{ moveAnnouncement }}
          </p>
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
            <!-- Companion invite has no backing endpoint yet (no
                 trip_collaborators table). Disabled rather than a silent
                 no-op; the reason lives in visible/sr-reachable text, not
                 just `title`, so it isn't dropped for keyboard/AT users.
                 @todo Re-enable once a trip collaborator/invite endpoint
                 exists. -->
            <button
              class="label label--plain"
              style="
                font-size: 10px;
                border: none;
                background: none;
                color: var(--accent-ink);
              "
              disabled
            >
              invite
              <span class="visually-hidden">
                ({{ INVITE_UNAVAILABLE_TITLE }})
              </span>
            </button>
          </h4>
          <div class="companions">
            <div
              class="companion companion--disabled"
              :title="INVITE_UNAVAILABLE_TITLE"
            >
              <span
                class="companion__av"
                style="background: var(--bg-tint); color: var(--muted)"
              >
                <AppIcon name="plus" :size="16" />
              </span>
              <div><b>Invite someone</b><br /><span>coming soon</span></div>
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
import { moveIdUp, moveIdDown, moveIdToDropTarget } from "~/utils/stopOrder";
import type { StopOrderMutator } from "~/utils/stopOrder";
import { INVITE_UNAVAILABLE_TITLE } from "~/constants/trips";
import { useClerkGatedFetch } from "~/composables/useClerkGatedFetch";

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

// Drag-and-drop + keyboard reorder state. isReordering guards against
// overlapping requests (a second drag/click while one is still persisting).
const draggedStopId = ref<string | null>(null);
const dragOverStopId = ref<string | null>(null);
const isReordering = ref(false);
const moveAnnouncement = ref("");

// While a reorder is in flight (or has just landed), the visual order can
// differ from the store's last-committed order (tripDetail.stops) — this is
// the optimistic override. Null once nothing is pending, at which point the
// list falls back to the store's own order.
const pendingStopOrder = ref<string[] | null>(null);

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

// A refetch only changes the answer once the viewer is a signed-in user who can
// carry a token; an anonymous visitor never gains one, so this (turned into
// retryGeneration by useClerkGatedFetch below) never advances a second time
// for them, but does re-issue the owner's request if their session resolves
// after the first pass, or clear a private trip on sign-out.
const canRetryAuthenticated = computed(
  () => isClerkLoaded.value && !!isSignedIn.value,
);

// Gated on Clerk's bootstrap (#255) so an owner's first request already
// carries a token instead of 404ing anonymously first — see
// useClerkGatedFetch.
const { gate: gateOnClerkLoad, retryGeneration } = useClerkGatedFetch(
  isClerkLoaded,
  canRetryAuthenticated,
);

function fetchTripDetail(): Promise<void> {
  return gateOnClerkLoad(() => tripsStore.fetchTripById(tripId.value));
}

// `server: false` keeps the fetch client-only, mirroring guides/[id].vue and
// u/[id].vue: the request carries the Clerk session token, which only exists on
// the client (Clerk runs with skipServerMiddleware). Running it during SSR would
// hang, since Clerk's getToken never resolves on the server.
//
// Watch retryGeneration as well as the id: a signed-in owner's session
// resolving after the fetch above already fired (e.g. signing in without a
// full page reload) re-issues the request with a token so the owner gets
// their private trip; signing out re-issues it anonymously so a private trip
// clears from the screen.
const { status: fetchStatus, refresh: refreshTripDetail } = useAsyncData(
  () => `trip-detail-${tripId.value}`,
  fetchTripDetail,
  { server: false, watch: [tripId, retryGeneration] },
);

// A 404 means the trip is missing or private — rendered as "Trip not found"
// below. Any other failure (5xx, network) is retryable and must not look like
// a missing trip to a share-link visitor, so it gets its own error state.
const detailLoadError = computed(() => tripsStore.detailError);

async function onRetryLoad(): Promise<void> {
  await refreshTripDetail();
}

// Until the client fetch resolves, the SSR pass and hydration frame have no trip
// yet. Treat that window as loading so a valid trip never flashes "Trip not
// found" before its data arrives. isLoading itself does not read isClerkLoaded
// directly — it only cares whether the fetch above has settled — but
// fetchTripDetail's gate (see useClerkGatedFetch) means this stays true until
// Clerk resolves one way or the other, or CLERK_BOOTSTRAP_TIMEOUT_MS lapses if
// it never does. That bound is what still lets an anonymous visitor following
// a shared link see a public trip even if Clerk's script is fully blocked,
// same as before #255 — this fix only changes when the anonymous fetch fires
// while Clerk resolves normally, not what happens if it never does.
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

// The order actually rendered: the optimistic pending order while a drag or
// move-button reorder is in flight, otherwise the store's committed order.
// Falling back to sortedStops keeps every other computed/template reference
// correct without threading isReordering through them individually.
//
// pendingStopOrder can reference a stop id the current tripDetail no longer
// has — e.g. a concurrent deleteStop resolving mid-flight, or (despite the
// requestTripId guard in persistStopOrder and the tripId watcher below) a
// navigation landing between renders. Rather than silently dropping the ids
// that no longer resolve — which would render a partial/empty itinerary —
// fall back to the committed order whenever any id can't be resolved.
const displayedStops = computed<TripStop[]>(() => {
  if (!pendingStopOrder.value || !tripDetail.value) {
    return sortedStops.value;
  }

  const stopsById = new Map(
    tripDetail.value.stops.map((stop) => [stop.id, stop]),
  );
  const resolvedStops = pendingStopOrder.value.map((stopId) =>
    stopsById.get(stopId),
  );
  const hasUnresolvedStop = resolvedStops.some((stop) => stop == null);
  if (hasUnresolvedStop) {
    return sortedStops.value;
  }

  return resolvedStops as TripStop[];
});

// A pending optimistic order (and any in-flight reorder's error/announcement
// state) belongs to the trip it was computed for; discard all of it on
// navigation so none of it can be misapplied to a different trip's stops (see
// the displayedStops fallback above for the belt-and-suspenders case where a
// stale pendingStopOrder lingers anyway).
watch(tripId, () => {
  pendingStopOrder.value = null;
  isReordering.value = false;
  reorderError.value = null;
  moveAnnouncement.value = "";
});

// Cap at 6 stops to fit the mini-map without overlapping pins
const mapPins = computed<TripStop[]>(() => displayedStops.value.slice(0, 6));

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
  const index = displayedStops.value.findIndex(
    (candidateStop) => candidateStop.id === stop.id,
  );
  return index + 1;
}

function isFirstStop(stop: TripStop): boolean {
  return displayedStops.value[0]?.id === stop.id;
}

function isLastStop(stop: TripStop): boolean {
  return displayedStops.value.at(-1)?.id === stop.id;
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

// aria-live only announces on an actual text mutation, so writing the same
// message twice in a row (e.g. the same stop failing to move on two
// consecutive attempts) would announce nothing the second time. Clearing the
// region first, on its own tick, guarantees every call is a real mutation.
async function announceMove(message: string): Promise<void> {
  moveAnnouncement.value = "";
  await nextTick();
  moveAnnouncement.value = message;
}

// Shared by drag-and-drop and the move-up/move-down buttons: applies the new
// order optimistically, then persists it via the existing reorder endpoint.
// On success the store's own order already matches newOrder (verified by
// tests/trips-store.test.ts's reorderStops coverage), so clearing the override
// causes no flicker; on failure the store was never touched, so clearing it
// reverts the view to the last-committed (pre-reorder) order. Guarded on
// isReordering so a second move started before the first settles is dropped
// rather than interleaving two in-flight requests — the move buttons stay
// enabled throughout (see onMoveStopUp/Down) so this guard, not a disabled
// attribute, is what makes that safe. A dropped move still gets a live-region
// announcement: silently ignoring the click would look like a hang to a
// screen-reader user, who has no visual cue that a save is already underway.
async function persistStopOrder(
  newOrder: string[],
  movedStopId: string,
  movedStopName: string,
): Promise<void> {
  if (!tripId.value) {
    return;
  }
  if (isReordering.value) {
    await announceMove(
      `Still saving the previous move. ${movedStopName} was not moved.`,
    );
    return;
  }

  // Captured up front: if the user navigates to a different trip before this
  // request settles, tripId.value will have moved on by the time the await
  // below resolves, and none of this request's outcome — order, error,
  // announcement — belongs to whatever trip is on screen by then.
  const requestTripId = tripId.value;
  pendingStopOrder.value = newOrder;
  isReordering.value = true;
  reorderError.value = null;

  try {
    await tripsStore.reorderStops(requestTripId, newOrder);
    if (tripId.value !== requestTripId) {
      return;
    }
    const newPosition = newOrder.indexOf(movedStopId);
    await announceMove(
      `Moved ${movedStopName} to position ${newPosition + 1} of ${newOrder.length}`,
    );
  } catch (error) {
    // Revert the optimistic order before announcing: nextTick() inside
    // announceMove flushes a render, and without this the error banner would
    // show for one frame above a list still showing the failed reorder.
    pendingStopOrder.value = null;
    if (tripId.value !== requestTripId) {
      return;
    }
    reorderError.value =
      error instanceof Error ? error.message : "Failed to reorder stops";
    await announceMove(
      `Could not move ${movedStopName}. The order was not changed.`,
    );
  } finally {
    if (tripId.value === requestTripId) {
      pendingStopOrder.value = null;
      isReordering.value = false;
    }
  }
}

// Shared by the drop handler and both move buttons: compute the candidate
// order, bail (no-op) if the mover didn't actually produce a new order, else
// persist it.
async function applyStopOrder(
  computeOrder: StopOrderMutator,
  movedStopId: string,
  movedStopName: string,
): Promise<void> {
  const currentOrder = displayedStops.value.map((stop) => stop.id);
  const newOrder = computeOrder(currentOrder);
  if (newOrder === currentOrder) {
    return;
  }
  await persistStopOrder(newOrder, movedStopId, movedStopName);
}

// The move buttons are deliberately never disabled while a reorder is in
// flight (persistStopOrder's isReordering guard makes that safe — see its
// comment) because a disabled button loses focus to <body>, forcing a
// keyboard/screen-reader user to re-tab through the whole itinerary after
// every single move. Instead, focus is restored here once the order settles:
// back onto the same button if it's still usable, otherwise onto its sibling
// (the button crossed a boundary, e.g. move-up from the second-to-first slot).
async function refocusMoveButton(
  clickedButton: HTMLButtonElement,
): Promise<void> {
  await nextTick();
  if (!clickedButton.disabled) {
    clickedButton.focus();
    return;
  }
  clickedButton.parentElement
    ?.querySelector<HTMLButtonElement>(".stop__move-btn:not(:disabled)")
    ?.focus();
}

function onStopDragStart(stop: TripStop, event: DragEvent): void {
  if (!isOwner.value || isReordering.value) {
    event.preventDefault();
    return;
  }
  // Firefox cancels a drag outright unless dataTransfer carries data set
  // during dragstart; Chrome/Safari are lenient, which is why this was easy
  // to miss without cross-browser testing.
  event.dataTransfer?.setData("text/plain", stop.id);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
  draggedStopId.value = stop.id;
}

function onStopDragOver(stop: TripStop, event: DragEvent): void {
  // Only claim the hover (and later the drop) when an in-app drag is active.
  // Calling preventDefault() unconditionally here would mark every row a
  // valid drop target for ANY drag — including a non-owner's read-only page,
  // or an external link/file dragged over the itinerary — silently
  // swallowing drops the app has no intention of handling.
  if (!draggedStopId.value) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  dragOverStopId.value = stop.id;
}

// dragleave fires whenever the pointer crosses into a descendant (the card,
// its icons, etc.), not just when it truly leaves the row — ignore leaves
// that land on a node still inside the current row so the drop-target outline
// doesn't flicker while dragging across a card's contents.
function onStopDragLeave(stop: TripStop, event: DragEvent): void {
  const nextTarget = event.relatedTarget as Node | null;
  const row = event.currentTarget as HTMLElement | null;
  if (nextTarget && row?.contains(nextTarget)) {
    return;
  }
  if (dragOverStopId.value === stop.id) {
    dragOverStopId.value = null;
  }
}

function onStopDragEnd(): void {
  draggedStopId.value = null;
  dragOverStopId.value = null;
}

async function onStopDrop(
  targetStop: TripStop,
  event: DragEvent,
): Promise<void> {
  const draggedId = draggedStopId.value;
  draggedStopId.value = null;
  dragOverStopId.value = null;

  // Same reasoning as onStopDragOver: only intercept the drop if it's ours to
  // handle. A drop with no active draggedStopId (external content, or a
  // non-owner's read-only page where dragstart can never have set it) falls
  // through to the browser's own default handling instead of being swallowed.
  if (!draggedId) {
    return;
  }
  event.preventDefault();

  if (draggedId === targetStop.id) {
    return;
  }

  const draggedStop = displayedStops.value.find(
    (stop) => stop.id === draggedId,
  );
  await applyStopOrder(
    (currentOrder) =>
      moveIdToDropTarget(currentOrder, draggedId, targetStop.id),
    draggedId,
    draggedStop?.name ?? "stop",
  );
}

async function onMoveStopUp(stop: TripStop, event: MouseEvent): Promise<void> {
  // Captured before the first await: DOM event objects reset currentTarget
  // to null once dispatch finishes, which happens well before the async work
  // below completes.
  const clickedButton = event.currentTarget as HTMLButtonElement;
  await applyStopOrder(
    (currentOrder) => moveIdUp(currentOrder, stop.id),
    stop.id,
    stop.name,
  );
  await refocusMoveButton(clickedButton);
}

async function onMoveStopDown(
  stop: TripStop,
  event: MouseEvent,
): Promise<void> {
  const clickedButton = event.currentTarget as HTMLButtonElement;
  await applyStopOrder(
    (currentOrder) => moveIdDown(currentOrder, stop.id),
    stop.id,
    stop.name,
  );
  await refocusMoveButton(clickedButton);
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
</script>

<style scoped>
.loading-state,
.empty-state {
  padding: 60px 0;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}
.empty-state__signin,
.empty-state__back {
  display: inline-block;
  margin-top: 10px;
  color: var(--accent-ink);
  text-decoration: none;
}
.empty-state__signin:hover,
.empty-state__back:hover {
  text-decoration: underline;
}
.empty-state__retry {
  margin-top: 12px;
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
.iti__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.stop {
  position: relative;
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 14px;
  margin-bottom: 16px;
}
.stop[draggable="true"] {
  cursor: grab;
}
.stop--dragging {
  opacity: 0.5;
}
.stop--drag-over {
  outline: 2px dashed var(--accent);
  outline-offset: 4px;
  border-radius: var(--radius);
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
.stop__reorder {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.stop__move-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.stop__move-btn:hover:not(:disabled) {
  background: var(--bg-tint);
  color: var(--accent-ink);
}
.stop__move-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.stop__grip {
  color: var(--faint);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
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
.companion--disabled,
.label--plain:disabled {
  cursor: not-allowed;
  opacity: 0.6;
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
