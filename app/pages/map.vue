<template>
  <div class="map-stage" :data-mapstyle="mapStyle">
    <AppTopbar title="Map" crumb="Home">
      <span class="tag tag--accent"
        >{{ placesStore.places.length }} places ·
        {{ mapStats.countriesCount }} countries</span
      >
      <button class="btn btn--primary btn--sm" @click="onDropPin">
        <AppIcon name="plus" :size="14" />
        drop a pin
      </button>
    </AppTopbar>

    <!-- Map panel: Mapbox GL mounts here when token is present -->
    <div ref="mapPanelRef" class="map-panel">
      <template v-if="!mapboxReady">
        <div class="topo map-topo" />
        <span class="map-mount">mapbox gl · #mapPanel</span>
      </template>
      <span v-if="!mapboxReady" class="map-attr">© Mapbox © OpenStreetMap</span>
    </div>

    <!-- Fallback pins rendered in DOM only when Mapbox is not active.
         When Mapbox is active, markers are owned by the map. -->
    <template v-if="!mapboxReady">
      <button
        v-for="place in pinnedPlaces"
        :key="place.id"
        class="pin-abs sm"
        :class="{ 'is-active': selectedPlace?.id === place.id }"
        :aria-label="place.name"
        @click="selectPlace(place)"
      >
        <span class="pin-ring" />
        <AppIcon name="pin" :size="18" class="pin" />
      </button>
    </template>

    <!-- Places load error -->
    <div v-if="placesStore.error" class="places-error" role="alert">
      {{ placesStore.error }}
    </div>

    <!-- Map init error (bad token, WebGL unsupported, etc.) -->
    <div v-if="mapError" class="places-error" role="alert">
      Map failed to load: {{ mapError }}
    </div>

    <!-- Stats load error -->
    <div v-if="statsError" class="places-error" role="alert">
      Stats unavailable: {{ statsError }}
    </div>

    <!-- Drop-pin mode indicator -->
    <div v-if="isDropPinMode" class="drop-pin-banner" role="status">
      Click the map to place a pin, then complete the form below.
      <button class="btn btn--sm" @click="cancelDropPin">Cancel</button>
    </div>

    <!-- Drop-pin create form -->
    <div
      v-if="dropPinCoords"
      class="drop-pin-form"
      role="dialog"
      aria-label="Create place"
    >
      <div class="drop-pin-form__title">New place</div>
      <div class="drop-pin-form__coords">
        {{ dropPinCoords.latitude.toFixed(4) }},
        {{ dropPinCoords.longitude.toFixed(4) }}
      </div>
      <input
        v-model="newPlaceName"
        class="drop-pin-form__input"
        placeholder="Place name…"
        aria-label="Place name"
      />
      <div class="hstack gap-8">
        <button
          class="btn btn--primary btn--sm"
          :disabled="!newPlaceName.trim() || isCreatingPlace"
          @click="submitDropPin"
        >
          Save
        </button>
        <button class="btn btn--sm" @click="dismissDropPinForm">Cancel</button>
      </div>
      <div v-if="createPlaceError" class="drop-pin-form__error" role="alert">
        {{ createPlaceError }}
      </div>
    </div>

    <!-- Places panel -->
    <div class="places">
      <div class="places__head">
        <div class="label">// your places</div>
        <div class="places__search">
          <AppIcon name="search" :size="15" />
          <input v-model="searchQuery" placeholder="Search places…" />
        </div>
      </div>
      <div class="chips">
        <span
          v-for="filter in filters"
          :key="filter"
          class="chip"
          :class="{ 'is-active': activeFilter === filter }"
          @click="activeFilter = filter"
          >{{ filter }}</span
        >
      </div>
      <div class="place-list">
        <div
          v-for="place in filteredPlaces"
          :key="place.id"
          class="place-item"
          :class="{ 'is-active': selectedPlace?.id === place.id }"
          @click="selectPlace(place)"
        >
          <span class="place-item__dot" />
          <div>
            <div class="place-item__name">{{ place.name }}</div>
            <div class="place-item__sub">{{ place.subtitle }}</div>
          </div>
          <span class="place-item__n">{{ place.category ?? "" }}</span>
        </div>
      </div>
    </div>

    <!-- Detail card -->
    <div class="detail" :class="{ 'is-open': selectedPlace }">
      <template v-if="selectedPlace">
        <div class="detail__img ph">
          <div class="topo" style="opacity: 0.5" />
          <button
            class="icon-btn detail__close"
            aria-label="Close"
            @click="closeDetail"
          >
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="detail__body">
          <div class="detail__loc">{{ selectedPlace.subtitle ?? "" }}</div>
          <div class="detail__name">{{ selectedPlace.name }}</div>
          <div class="detail__stats">
            <div>
              <div class="n">{{ selectedPlace.country ?? "" }}</div>
              <div class="l">country</div>
            </div>
            <div>
              <div class="n">{{ selectedPlace.category ?? "" }}</div>
              <div class="l">category</div>
            </div>
            <div>
              <div class="n">{{ selectedPlace.latitude ?? "—" }}</div>
              <div class="l">lat</div>
            </div>
          </div>
          <div class="hstack gap-8">
            <NuxtLink
              class="btn btn--primary btn--sm"
              to="/journal"
              style="flex: 1"
            >
              <AppIcon name="journal" :size="14" />
              open journal
            </NuxtLink>
            <button
              class="icon-btn"
              aria-label="Edit place"
              :aria-expanded="isEditingPlace"
              @click="toggleEditForm"
            >
              <AppIcon name="edit" :size="18" />
            </button>
            <button class="icon-btn" aria-label="Save">
              <AppIcon name="heart" :size="18" />
            </button>
          </div>
        </div>
        <PlaceEditForm
          v-if="isEditingPlace"
          :key="selectedPlace.id"
          :place="selectedPlace"
          :pending="isUpdatingSelectedPlace"
          :error="updatePlaceError"
          @submit="submitEditPlace"
          @cancel="closeEditForm"
        />
      </template>
    </div>

    <!-- Map controls -->
    <div class="map-controls">
      <div class="layers-pop" :class="{ 'is-open': layersPopOpen }">
        <div class="layers-pop__h">// base map style</div>
        <div
          v-for="style in mapStyles"
          :key="style.value"
          class="lstyle"
          :class="{ 'is-active': mapStyle === style.value }"
          @click="setMapStyle(style.value)"
        >
          <span class="lstyle__sw" :class="`sw-${style.value}`" />
          <span class="lstyle__n">{{ style.label }}</span>
          <AppIcon name="check" :size="14" class="lstyle__c" />
        </div>
      </div>
      <button
        class="map-cbtn"
        :class="{ 'is-active': layersPopOpen }"
        aria-label="Map style"
        @click="layersPopOpen = !layersPopOpen"
      >
        <AppIcon name="layers" :size="18" />
      </button>
      <div class="zoom">
        <button aria-label="Zoom in" @click="onZoomIn">
          <AppIcon name="plus" :size="16" />
        </button>
        <button aria-label="Zoom out" @click="onZoomOut">
          <svg
            class="ico"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>

    <div class="legend">
      {{ mapStyleLegend }} · {{ pinnedPlaces.length }} pins
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { usePlacesStore } from "~/stores/places";
import type { Place, UpdatePlaceInput } from "~/stores/places";
import { useMapbox } from "~/composables/useMapbox";
import { resolveMapboxStyleLabel } from "~/composables/useMapboxStyles";
import type { DropPinResult, MapInstance } from "~/composables/useMapbox";
import { useStats } from "~/composables/useStats";

definePageMeta({ layout: "app", middleware: "auth" });
useHead({ title: "Wanderist — Map" });

const placesStore = usePlacesStore();
const mapbox = useMapbox();
const {
  stats: mapStats,
  fetchStats: fetchMapStats,
  loadError: statsError,
} = useStats();

const mapPanelRef = ref<HTMLElement | null>(null);
const activeMapInstance = ref<MapInstance | null>(null);
const mapboxReady = ref(false);
const isUnmounted = ref(false);

const filters = ["All", "2026", "Journaled", "Wishlist"];
const mapStyles = [
  { value: "outdoors", label: "Outdoors" },
  { value: "streets", label: "Streets" },
  { value: "satellite", label: "Satellite" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "custom", label: "Wanderist violet" },
];

const selectedPlace = ref<Place | null>(null);
const activeFilter = ref("All");
const mapStyle = ref("outdoors");

const searchQuery = ref("");
const layersPopOpen = ref(false);
const isDropPinMode = ref(false);
const dropPinCoords = ref<DropPinResult | null>(null);
const newPlaceName = ref("");
const isCreatingPlace = ref(false);
const createPlaceError = ref<string | null>(null);
const mapError = ref<string | null>(null);
const isEditingPlace = ref(false);
// The id of the place whose PATCH is in flight (null when idle). Scoping this
// to an id — rather than a bare boolean — keeps the spinner/disabled state tied
// to one place, so switching selection mid-save can't strand a different place
// in a "saving" state, and re-opening the form can't fire a duplicate PATCH.
const updatingPlaceId = ref<string | null>(null);
const updatePlaceError = ref<string | null>(null);

const isUpdatingSelectedPlace = computed(
  () =>
    updatingPlaceId.value !== null &&
    updatingPlaceId.value === selectedPlace.value?.id,
);

const pinnedPlaces = computed(() =>
  placesStore.places.filter(
    (place) => place.latitude !== null && place.longitude !== null,
  ),
);

const filteredPlaces = computed(() => {
  const term = searchQuery.value.trim().toLowerCase();

  if (!term) {
    return placesStore.places;
  }

  return placesStore.places.filter(
    (place) =>
      place.name.toLowerCase().includes(term) ||
      (place.subtitle ?? "").toLowerCase().includes(term),
  );
});

const mapStyleLegend = computed(() => resolveMapboxStyleLabel(mapStyle.value));

function selectPlace(place: Place): void {
  const previousId = selectedPlace.value?.id ?? null;
  selectedPlace.value = place;

  // Only a genuine change of selection discards an in-progress edit; clicking
  // the already-selected place must not wipe a half-typed form.
  if (previousId !== place.id) {
    closeEditForm();
  }

  if (activeMapInstance.value) {
    mapbox.setMarkerActive(place.id, previousId);
  }
}

// Map markers report the clicked id (their click handler is bound once and
// can't hold a live reference to an edited place), so resolve the current
// store object here rather than trusting a captured one.
function selectPlaceById(placeId: string): void {
  const place = placesStore.places.find(
    (candidate) => candidate.id === placeId,
  );

  if (!place) {
    // Markers and store state should never diverge (syncMarkers prunes stale
    // markers), so a click with no matching place is a bug worth surfacing.
    console.warn(`Marker clicked for unknown place ${placeId}`);
    return;
  }

  selectPlace(place);
}

function closeDetail(): void {
  if (activeMapInstance.value && selectedPlace.value) {
    mapbox.setMarkerActive(null, selectedPlace.value.id);
  }
  selectedPlace.value = null;
  closeEditForm();
}

function toggleEditForm(): void {
  if (isEditingPlace.value) {
    closeEditForm();
    return;
  }
  updatePlaceError.value = null;
  isEditingPlace.value = true;
}

function closeEditForm(): void {
  // Leave updatingPlaceId alone — the in-flight PATCH's finally owns it, so
  // closing/reopening the form can't drop the guard and fire a duplicate save.
  isEditingPlace.value = false;
  updatePlaceError.value = null;
}

async function submitEditPlace(input: UpdatePlaceInput): Promise<void> {
  if (!selectedPlace.value || updatingPlaceId.value !== null) {
    return;
  }

  // Capture the target id so a slow PATCH can't resurrect or clobber a
  // selection the user changed (or closed) while the request was in flight.
  const editedPlaceId = selectedPlace.value.id;
  updatingPlaceId.value = editedPlaceId;
  updatePlaceError.value = null;

  try {
    const updated = await placesStore.updatePlace(editedPlaceId, input);

    if (selectedPlace.value?.id !== editedPlaceId) {
      return;
    }

    selectedPlace.value = updated;
    isEditingPlace.value = false;
  } catch (error) {
    if (selectedPlace.value?.id !== editedPlaceId) {
      return;
    }

    updatePlaceError.value =
      error instanceof Error ? error.message : "Failed to update place";
  } finally {
    updatingPlaceId.value = null;
  }
}

function setMapStyle(style: string): void {
  mapStyle.value = style;
  layersPopOpen.value = false;

  if (activeMapInstance.value) {
    mapbox.setStyle(activeMapInstance.value, style);
  }
}

function onZoomIn(): void {
  if (activeMapInstance.value) {
    mapbox.zoomIn(activeMapInstance.value);
  }
}

function onZoomOut(): void {
  if (activeMapInstance.value) {
    mapbox.zoomOut(activeMapInstance.value);
  }
}

function onDropPin(): void {
  if (!activeMapInstance.value) {
    return;
  }

  isDropPinMode.value = true;
  dropPinCoords.value = null;
  newPlaceName.value = "";
  createPlaceError.value = null;

  mapbox.startDropPin(activeMapInstance.value, (coords) => {
    isDropPinMode.value = false;
    dropPinCoords.value = coords;
  });
}

function cancelDropPin(): void {
  isDropPinMode.value = false;
  mapbox.cancelDropPin();
}

function dismissDropPinForm(): void {
  dropPinCoords.value = null;
  newPlaceName.value = "";
  createPlaceError.value = null;
  mapbox.cancelDropPin();
}

async function submitDropPin(): Promise<void> {
  if (!dropPinCoords.value || !newPlaceName.value.trim()) {
    return;
  }

  isCreatingPlace.value = true;
  createPlaceError.value = null;

  try {
    const created = await placesStore.createPlace({
      name: newPlaceName.value.trim(),
      latitude: dropPinCoords.value.latitude,
      longitude: dropPinCoords.value.longitude,
    });

    dropPinCoords.value = null;
    newPlaceName.value = "";
    mapbox.cancelDropPin();

    if (activeMapInstance.value) {
      await mapbox.syncMarkers(
        activeMapInstance.value,
        placesStore.places,
        selectedPlace.value?.id ?? null,
        selectPlaceById,
      );
    }

    selectPlace(created);
  } catch (error) {
    createPlaceError.value =
      error instanceof Error ? error.message : "Failed to create place";
  } finally {
    isCreatingPlace.value = false;
  }
}

async function initializeMap(): Promise<void> {
  if (!mapPanelRef.value || !mapbox.hasToken()) {
    return;
  }

  const mapInstance = await mapbox.initMap(
    mapPanelRef.value,
    mapStyle.value,
    (error) => {
      mapError.value = error.message;
    },
  );

  if (!mapInstance) {
    return;
  }

  // Guard against the component unmounting while initMap was awaiting
  if (isUnmounted.value) {
    mapbox.destroyMap(mapInstance);
    return;
  }

  activeMapInstance.value = mapInstance;

  mapInstance.on("load", async () => {
    if (isUnmounted.value) {
      return;
    }

    mapboxReady.value = true;

    await mapbox.syncMarkers(
      mapInstance,
      placesStore.places,
      selectedPlace.value?.id ?? null,
      selectPlaceById,
    );
  });
}

// Shallow watch is sufficient: usePlacesStore always reassigns places.value
// (spread/map/filter) rather than mutating the array in place.
watch(
  () => placesStore.places,
  async (places) => {
    if (!activeMapInstance.value || !mapboxReady.value) {
      return;
    }

    await mapbox.syncMarkers(
      activeMapInstance.value,
      places,
      selectedPlace.value?.id ?? null,
      selectPlaceById,
    );
  },
);

onMounted(async () => {
  await placesStore.fetchPlaces().catch(() => undefined);
  await initializeMap();
  fetchMapStats();
});

onBeforeUnmount(() => {
  isUnmounted.value = true;

  if (activeMapInstance.value) {
    mapbox.destroyMap(activeMapInstance.value);
    activeMapInstance.value = null;
  }
});
</script>

<style scoped>
.map-stage {
  position: relative;
  flex: 1;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.map-panel {
  position: absolute;
  inset: 0;
  border: none;
  border-radius: 0;
}
.map-topo {
  opacity: 0.42;
}
.map-mount {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--muted);
  opacity: 0.42;
  pointer-events: none;
  white-space: nowrap;
}
.map-attr {
  position: absolute;
  right: 10px;
  bottom: 8px;
  z-index: 1;
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: var(--muted);
  opacity: 0.7;
  pointer-events: none;
}

.map-stage[data-mapstyle="outdoors"] .map-panel {
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0 39px,
      color-mix(in srgb, var(--line) 60%, transparent) 39px 40px
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 39px,
      color-mix(in srgb, var(--line) 60%, transparent) 39px 40px
    ),
    var(--bg-tint);
}
.map-stage[data-mapstyle="streets"] .map-panel {
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0 23px,
      color-mix(in srgb, var(--line-strong) 55%, transparent) 23px 24px
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 23px,
      color-mix(in srgb, var(--line-strong) 55%, transparent) 23px 24px
    ),
    repeating-linear-gradient(
      38deg,
      transparent 0 139px,
      color-mix(in srgb, var(--accent) 16%, transparent) 139px 143px
    ),
    #f6f4ef;
}
.map-stage[data-mapstyle="satellite"] .map-panel {
  background:
    radial-gradient(circle at 28% 30%, #324326, transparent 55%),
    radial-gradient(circle at 72% 64%, #1d3344, transparent 52%),
    linear-gradient(135deg, #283520, #18242f);
}
.map-stage[data-mapstyle="light"] .map-panel {
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0 47px,
      color-mix(in srgb, var(--line) 45%, transparent) 47px 48px
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 47px,
      color-mix(in srgb, var(--line) 45%, transparent) 47px 48px
    ),
    #fbfaf7;
}
.map-stage[data-mapstyle="dark"] .map-panel {
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0 39px,
      rgba(255, 255, 255, 0.05) 39px 40px
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 39px,
      rgba(255, 255, 255, 0.05) 39px 40px
    ),
    #15140f;
}
.map-stage[data-mapstyle="custom"] .map-panel {
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0 39px,
      color-mix(in srgb, var(--accent) 13%, transparent) 39px 40px
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 39px,
      color-mix(in srgb, var(--accent) 13%, transparent) 39px 40px
    ),
    color-mix(in srgb, var(--accent-weak) 72%, var(--bg-tint));
}

.map-controls {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 11;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.map-cbtn {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow);
  color: var(--ink-2);
  display: grid;
  place-items: center;
}
.map-cbtn:hover,
.map-cbtn.is-active {
  color: var(--accent-ink);
  border-color: var(--accent);
}
.map-cbtn .ico {
  width: 18px;
  height: 18px;
}

.layers-pop {
  position: absolute;
  right: 52px;
  bottom: 0;
  width: 212px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 7px;
  opacity: 0;
  transform: translateX(8px);
  pointer-events: none;
  transition:
    opacity 0.16s,
    transform 0.16s;
}
.layers-pop.is-open {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.layers-pop__h {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--faint);
  padding: 7px 9px 6px;
}
.lstyle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.lstyle:hover {
  background: var(--accent-weak);
}
.lstyle__sw {
  width: 30px;
  height: 24px;
  border-radius: 5px;
  border: 1px solid var(--line);
  flex: none;
}
.lstyle__n {
  font-size: 12px;
  color: var(--ink);
}
.lstyle__c {
  margin-left: auto;
  width: 14px;
  height: 14px;
  color: var(--accent);
  opacity: 0;
  flex: none;
}
.lstyle.is-active .lstyle__c {
  opacity: 1;
}
.lstyle.is-active .lstyle__n {
  color: var(--accent-ink);
  font-weight: 600;
}
.sw-outdoors {
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0 4px,
      color-mix(in srgb, var(--accent) 30%, transparent) 4px 5px
    ),
    var(--bg-tint);
}
.sw-streets {
  background:
    repeating-linear-gradient(90deg, #f6f4ef 0 4px, var(--line-strong) 4px 5px),
    repeating-linear-gradient(
      0deg,
      transparent 0 4px,
      var(--line-strong) 4px 5px
    ),
    #f6f4ef;
}
.sw-satellite {
  background: linear-gradient(135deg, #324326, #1d3344);
}
.sw-light {
  background:
    repeating-linear-gradient(90deg, #fbfaf7 0 6px, var(--line) 6px 7px),
    #fbfaf7;
}
.sw-dark {
  background:
    repeating-linear-gradient(90deg, #15140f 0 5px, #2c2a26 5px 6px), #15140f;
}
.sw-custom {
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0 4px,
      color-mix(in srgb, var(--accent) 35%, transparent) 4px 5px
    ),
    var(--accent-weak);
}

.places {
  position: absolute;
  top: 72px;
  left: 16px;
  width: 300px;
  max-height: calc(100% - 88px);
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  z-index: 10;
}
.places__head {
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--line);
}
.places__search {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  margin-top: 12px;
}
.places__search input {
  border: none;
  background: none;
  outline: none;
  width: 100%;
  font-size: 12.5px;
  color: var(--ink);
}
.chips {
  display: flex;
  gap: 6px;
  padding: 12px 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--line);
}
.chip {
  font-size: 11px;
  padding: 4px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 99px;
  color: var(--ink-2);
  cursor: pointer;
}
.chip.is-active {
  background: var(--accent-weak);
  color: var(--accent-ink);
  border-color: var(--accent-line);
  font-weight: 500;
}
.place-list {
  overflow-y: auto;
  padding: 8px;
}
.place-item {
  display: flex;
  gap: 11px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.place-item:hover,
.place-item.is-active {
  background: var(--accent-weak);
}
.place-item__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  margin-top: 5px;
  flex: none;
}
.place-item__name {
  font-size: 13px;
  font-weight: 500;
}
.place-item__sub {
  font-size: 11px;
  color: var(--muted);
}
.place-item__n {
  margin-left: auto;
  font-size: 11px;
  color: var(--faint);
}

.pin-abs {
  position: absolute;
  transform: translate(-50%, -100%);
  cursor: pointer;
  z-index: 4;
  transition: transform 0.12s;
  background: none;
  border: none;
  padding: 0;
}
.pin-abs.sm :deep(.ico) {
  width: 18px;
  height: 18px;
}
.pin-abs:not(.sm) :deep(.ico) {
  width: 26px;
  height: 26px;
}
.pin-abs:hover {
  transform: translate(-50%, -100%) scale(1.12);
  z-index: 6;
}
.pin-abs.is-active {
  z-index: 8;
}
.pin-abs.is-active .pin {
  color: var(--accent-ink);
  filter: drop-shadow(0 4px 8px rgba(124, 43, 217, 0.5));
}
.pin-ring {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 40px;
  height: 14px;
  transform: translate(-50%, 40%);
  border-radius: 50%;
  background: radial-gradient(
    closest-side,
    color-mix(in srgb, var(--accent) 40%, transparent),
    transparent
  );
  opacity: 0;
}
.pin-abs.is-active .pin-ring {
  opacity: 1;
}

.detail {
  position: absolute;
  right: 16px;
  top: 72px;
  width: 300px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  z-index: 12;
  transform: translateX(120%);
  transition: transform 0.26s cubic-bezier(0.2, 0.7, 0.3, 1);
}
.detail.is-open {
  transform: none;
}
.detail__img {
  height: 132px;
  position: relative;
}
.detail__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
}
.detail__body {
  padding: 16px;
}
.detail__loc {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-ink);
}
.detail__name {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  margin: 4px 0 8px;
}
.detail__stats {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
}
.detail__stats .n {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 600;
}
.detail__stats .l {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.zoom {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  box-shadow: var(--shadow);
}
.zoom button {
  width: 36px;
  height: 34px;
  border: none;
  background: none;
  color: var(--ink-2);
  display: grid;
  place-items: center;
}
.zoom button:first-child {
  border-bottom: 1px solid var(--line);
}
.zoom button:hover {
  background: var(--accent-weak);
  color: var(--accent-ink);
}
.legend {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 10;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid var(--line);
  padding: 6px 10px;
  border-radius: 99px;
}

.drop-pin-banner {
  position: absolute;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: var(--surface);
  border: 1px solid var(--accent-line);
  border-radius: var(--radius);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--ink);
  box-shadow: var(--shadow-lg);
}

.drop-pin-form {
  position: absolute;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  padding: 16px;
  width: 280px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.drop-pin-form__title {
  font-size: 14px;
  font-weight: 600;
}
.drop-pin-form__coords {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.drop-pin-form__input {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  padding: 8px 10px;
  font-size: 13px;
  color: var(--ink);
  outline: none;
  width: 100%;
}
.drop-pin-form__input:focus {
  border-color: var(--accent-line);
}
.drop-pin-form__error {
  font-size: 12px;
  color: var(--error, #c0392b);
}

.places-error {
  position: absolute;
  top: 80px;
  right: 16px;
  z-index: 20;
  background: var(--surface);
  border: 1px solid var(--error, #c0392b);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 13px;
  color: var(--error, #c0392b);
  box-shadow: var(--shadow);
}

@media (max-width: 760px) {
  .places {
    width: calc(100% - 32px);
    max-height: 44%;
  }
  .detail {
    width: calc(100% - 32px);
    top: auto;
    bottom: 16px;
  }
}
</style>
