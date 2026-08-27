<template>
  <div
    v-if="open"
    class="drawer new-entry is-open"
    role="dialog"
    aria-label="New entry"
  >
    <div class="drawer__scrim" @click="!isPublishing && emit('close')" />
    <aside class="drawer__panel">
      <header class="drawer__head">
        <div>
          <div class="label">// new entry</div>
          <h3 class="display" style="font-size: 18px; margin-top: 6px">
            Capture a moment
          </h3>
        </div>
        <button class="icon-btn" aria-label="Close" @click="emit('close')">
          <AppIcon name="x" :size="18" />
        </button>
      </header>

      <div class="drawer__body">
        <!-- Photo upload -->
        <div class="dropzone">
          <div class="dropzone__grid">
            <div
              v-for="photo in uploadedPhotos"
              :key="photo.id"
              class="ph dz-thumb"
            >
              <img
                :src="photo.url"
                alt=""
                style="width: 100%; height: 100%; object-fit: cover"
              />
            </div>
            <div v-if="uploadedPhotos.length < 2" class="ph dz-thumb">
              <div class="topo" />
            </div>
            <div v-if="uploadedPhotos.length < 1" class="ph dz-thumb">
              <div class="topo" />
            </div>
            <button
              class="dz-add"
              :disabled="isUploading"
              @click="triggerFileInput"
            >
              <AppIcon name="camera" :size="17" />
              <span>{{ isUploading ? "uploading…" : "add photos" }}</span>
            </button>
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              multiple
              style="display: none"
              @change="handleFileChange"
            />
          </div>
          <p class="dropzone__hint">
            Drag photos here, or import geotagged shots from
            <AppIcon name="instagram" :size="13" style="vertical-align: -2px" />
            Instagram.
          </p>
          <p v-if="uploadError" class="error-hint">{{ uploadError }}</p>
        </div>

        <!-- Title -->
        <div class="field">
          <label class="field__label">Title</label>
          <div class="field__wrap">
            <input
              v-model="form.title"
              class="field__input"
              placeholder="Give this moment a name…"
            />
          </div>
        </div>

        <!-- Entry text -->
        <div class="field">
          <label class="field__label">Entry</label>
          <textarea
            v-model="form.body"
            class="field__input"
            rows="5"
            placeholder="What happened? What did it feel like?"
          />
        </div>

        <!-- Location -->
        <div class="field">
          <label class="field__label">Location</label>
          <div class="field__wrap">
            <input v-model="form.location" class="field__input" />
            <span class="field__icon"><AppIcon name="pin" :size="16" /></span>
          </div>
          <div v-if="locationSuggestions.length" class="chip-suggest">
            <span
              v-for="suggestion in locationSuggestions"
              :key="suggestion"
              class="chip"
              @click="form.location = suggestion"
              >{{ suggestion }}</span
            >
          </div>
          <div v-if="canCreatePlace" class="location-create">
            <span class="location-create__hint"
              >No saved place matches this location.</span
            >
            <button
              class="btn btn--outline btn--sm location-create__btn"
              :disabled="isCreatingPlace"
              @click="handleCreatePlace"
            >
              <AppIcon name="plus" :size="12" />
              {{
                isCreatingPlace ? "creating…" : `Create “${canonicalLocation}”`
              }}
            </button>
          </div>
          <p v-if="createPlaceError" class="error-hint location-create__error">
            {{ createPlaceError }}
          </p>
          <p v-if="placesLoadFailed" class="error-hint places-load__error">
            Couldn't load your saved places, so suggestions and inline creation
            are unavailable. Your typed location is still saved when you
            publish.
          </p>
        </div>

        <!-- Trip -->
        <div class="field">
          <label class="field__label">Trip</label>
          <div class="pill-pick">
            <button
              v-for="trip in tripOptions"
              :key="trip.value"
              class="pick"
              :class="{ 'is-active': form.tripId === trip.value }"
              @click="selectTrip(trip.value)"
            >
              {{ trip.label }}
            </button>
          </div>
        </div>

        <!-- Date & Visibility row -->
        <div class="drawer__row">
          <div class="field" style="margin: 0">
            <label class="field__label">Date</label>
            <div class="field__wrap">
              <input v-model="form.date" class="field__input" type="date" />
              <span class="field__icon"
                ><AppIcon name="calendar" :size="16"
              /></span>
            </div>
          </div>
          <div class="field" style="margin: 0">
            <label class="field__label">Visibility</label>
            <div class="segmented seg-sm">
              <button
                :class="{ 'is-active': form.visibility === 'private' }"
                @click="form.visibility = 'private'"
              >
                Private
              </button>
              <button
                :class="{ 'is-active': form.visibility === 'public' }"
                @click="form.visibility = 'public'"
              >
                Public
              </button>
            </div>
          </div>
        </div>

        <!-- Tags -->
        <div class="field">
          <label class="field__label">Tags</label>
          <div class="tags-input">
            <span v-for="tag in form.tags" :key="tag" class="tag tag--accent">
              {{ tag }}
              <button
                class="tag-x"
                style="
                  background: none;
                  border: none;
                  padding: 0;
                  cursor: pointer;
                  font-size: 10px;
                "
                @click="removeTag(tag)"
              >
                ×
              </button>
            </span>
            <input
              v-model="tagInput"
              placeholder="add tag…"
              @keydown.enter.prevent="addTag"
            />
          </div>
        </div>

        <!-- Weather -->
        <div class="field" style="margin-bottom: 4px">
          <label class="field__label">
            Weather
            <span class="muted" style="text-transform: none; letter-spacing: 0"
              >optional</span
            >
          </label>
          <div class="pill-pick">
            <button
              v-for="weather in WEATHER_OPTIONS"
              :key="weather.value"
              class="pick"
              :class="{ 'is-active': form.weather === weather.value }"
              @click="form.weather = weather.value"
            >
              <AppIcon :name="weather.icon" :size="14" />
              {{ weather.label }}
            </button>
          </div>
        </div>

        <p v-if="publishError" class="error-hint">{{ publishError }}</p>
      </div>

      <footer class="drawer__foot">
        <button
          class="btn btn--ghost btn--sm"
          :disabled="isPublishing"
          @click="handleSaveDraft"
        >
          save draft
        </button>
        <span style="flex: 1" />
        <button
          class="btn btn--outline btn--sm"
          :disabled="isPublishing"
          @click="emit('close')"
        >
          cancel
        </button>
        <button
          class="btn btn--primary btn--sm"
          :disabled="isPublishing || isCreatingPlace"
          @click="publish"
        >
          <AppIcon name="check" :size="14" />
          {{ isPublishing ? "publishing…" : "publish" }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { Trip } from "~/stores/trips";
import type { Place } from "~/stores/places";

const MAX_LOCATION_SUGGESTIONS = 5;

const WEATHER_OPTIONS = [
  { value: "clear", label: "Clear", icon: "sun" },
  { value: "overcast", label: "Overcast", icon: "cloud" },
  { value: "windy", label: "Windy", icon: "wind" },
] as const;

const NO_TRIP_VALUE = "";

interface TripOption {
  value: string;
  label: string;
}

interface FormState {
  title: string;
  body: string;
  location: string;
  tripId: string;
  date: string;
  visibility: "private" | "public";
  tags: string[];
  weather: string;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const entriesStore = useEntriesStore();
const tripsStore = useTripsStore();
const placesStore = usePlacesStore();
const { upload, isUploading } = useMediaUpload();
const uploadError = ref<string | null>(null);
const { saveDraft, loadDraft, clearDraft } = useEntryDraft();

const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadedPhotos = ref<Array<{ id: string; url: string }>>([]);
const tagInput = ref("");
const isPublishing = ref(false);
const publishError = ref<string | null>(null);
const isCreatingPlace = ref(false);
const createPlaceError = ref<string | null>(null);

// Local (not store-global) signal that this drawer's own places load failed.
// Using the shared placesStore.error would let an unrelated page's failed fetch
// hide the affordance here for the rest of the session. Scoped by placesLoadToken
// so only the latest load may write the flag (an earlier slow failure can't
// clobber a later success across a reopen).
const placesLoadFailed = ref(false);
let placesLoadToken = 0;

// Monotonic token: bumped when a create starts and when the drawer reopens. A
// resolved place-create whose drawer has since been reset compares tokens to
// detect it is stale and skip writing its saved name back or resetting the
// isCreatingPlace flag on a fresh form. (The inline error message is guarded by
// name equality instead, since a stale error is only wrong once the field has
// moved off the name it was raised for.)
let activeCreateToken = 0;

// Normalized name of an in-flight place POST, or null. Survives a reopen (which
// resets isCreatingPlace) so the same name can't be created twice concurrently.
let pendingCreateName: string | null = null;

// One-shot flag: true once the default tripId has been applied, so a later
// trips-store update does not clobber an explicit "None" selection.
const tripDefaulted = ref(false);

function localIsoDate(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function defaultTripId(trips: Trip[]): string {
  const ongoing = trips.find((trip) => trip.status === "ongoing");
  return ongoing?.id ?? NO_TRIP_VALUE;
}

function buildInitialForm(trips: Trip[]): FormState {
  return {
    title: "",
    body: "",
    location: "",
    tripId: defaultTripId(trips),
    date: localIsoDate(),
    visibility: "private",
    tags: [],
    weather: "",
  };
}

const form = ref<FormState>(buildInitialForm(tripsStore.tripList));

function applyFreshForm(): void {
  form.value = buildInitialForm(tripsStore.tripList);
  uploadedPhotos.value = [];
  if (form.value.tripId !== NO_TRIP_VALUE) {
    tripDefaulted.value = true;
  }
}

const tripOptions = computed<TripOption[]>(() => {
  const options = tripsStore.tripList.map((trip) => ({
    value: trip.id,
    label: trip.name,
  }));
  return [...options, { value: NO_TRIP_VALUE, label: "None" }];
});

const locationSuggestions = computed<string[]>(() =>
  placesStore.places
    .map((place) => place.name)
    .slice(0, MAX_LOCATION_SUGGESTIONS),
);

// Canonical form actually persisted: collapse internal whitespace and unify
// Unicode form so the saved place matches the helper's comparison key and isn't
// stored in a sloppy "Blue  Lagoon" shape.
function canonicalPlaceName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

// Case-insensitive comparison key used only for matching, never persisted.
function normalizePlaceName(name: string): string {
  return canonicalPlaceName(name).toLowerCase();
}

const trimmedLocation = computed<string>(() => form.value.location.trim());

// The exact name that gets persisted, so the button label and the POST body
// agree (both use this, never the trim-only form).
const canonicalLocation = computed<string>(() =>
  canonicalPlaceName(form.value.location),
);

// The saved place matching a given name (case-insensitive), or null. Takes the
// name explicitly so the publish path can resolve against a snapshot rather than
// the live field, which stays editable during the async publish.
function findSavedPlace(name: string): Place | null {
  const target = normalizePlaceName(name);
  if (!target) {
    return null;
  }
  return (
    placesStore.places.find(
      (place) => normalizePlaceName(place.name) === target,
    ) ?? null
  );
}

const matchedPlace = computed<Place | null>(() =>
  findSavedPlace(form.value.location),
);

// The user typed a location that matches nothing we know about. Drives the
// publish path (a typed location must be persisted, never silently dropped) and
// is independent of list trustworthiness.
const hasUnsavedLocation = computed<boolean>(
  () => trimmedLocation.value.length > 0 && matchedPlace.value === null,
);

// Offer the inline affordance only when the places list is trustworthy: a
// not-yet-fetched or failed-to-fetch list can't back the "no saved place
// matches" claim, so hide the button (publish still persists via
// hasUnsavedLocation, so nothing is lost).
const canCreatePlace = computed<boolean>(
  () =>
    hasUnsavedLocation.value &&
    !placesStore.isLoading &&
    !placesLoadFailed.value,
);

function selectTrip(tripId: string): void {
  form.value.tripId = tripId;
  // Mark as explicitly chosen so the tripList watch no longer overrides it
  tripDefaulted.value = true;
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return;
    }

    tripDefaulted.value = false;

    const draft = loadDraft();

    if (draft) {
      form.value = {
        title: draft.title,
        body: draft.body,
        location: draft.location,
        tripId: draft.tripId,
        date: draft.date,
        visibility: draft.visibility,
        tags: draft.tags,
        weather: draft.weather,
      };
      uploadedPhotos.value = draft.uploadedPhotos ?? [];
      // Treat a restored draft's tripId as already-defaulted so it is preserved
      tripDefaulted.value = true;
    } else {
      applyFreshForm();
    }

    tagInput.value = "";
    publishError.value = null;
    uploadError.value = null;
    createPlaceError.value = null;
    isCreatingPlace.value = false;
    activeCreateToken += 1;

    if (!tripsStore.tripList.length) {
      tripsStore.fetchTrips();
    }

    // Mint the token unconditionally so a reopen that skips the fetch (because the
    // list is already populated) still invalidates any earlier in-flight load,
    // stopping its late failure from marking a now-healthy list as failed.
    placesLoadFailed.value = false;
    const loadToken = (placesLoadToken += 1);
    if (!placesStore.places.length) {
      // Track load failure locally so the affordance can hide, scoped by token so
      // only the latest load writes the flag. Publish still persists via the
      // hasUnsavedLocation path, so a failed load never drops a typed location.
      placesStore
        .fetchPlaces()
        .then(() => {
          if (loadToken === placesLoadToken) {
            placesLoadFailed.value = false;
          }
        })
        .catch(() => {
          if (loadToken === placesLoadToken) {
            placesLoadFailed.value = true;
          }
        });
    }
  },
  { immediate: true },
);

// Apply a default tripId once trips arrive if none has been set yet
watch(
  () => tripsStore.tripList,
  (trips) => {
    if (tripDefaulted.value) {
      return;
    }
    if (!trips.length) {
      return;
    }
    form.value.tripId = defaultTripId(trips);
    tripDefaulted.value = true;
  },
);

// A create error belongs to the name it was raised for; once the user edits the
// location the message is stale, so clear it.
watch(trimmedLocation, () => {
  createPlaceError.value = null;
});

function addTag(): void {
  const value = tagInput.value.trim();
  if (value && !form.value.tags.includes(value)) {
    form.value.tags = [...form.value.tags, value];
  }
  tagInput.value = "";
}

function removeTag(tag: string): void {
  form.value.tags = form.value.tags.filter(
    (existingTag) => existingTag !== tag,
  );
}

function triggerFileInput(): void {
  fileInputRef.value?.click();
}

async function uploadOne(
  file: File,
): Promise<{ id: string; url: string } | null> {
  try {
    return await upload(file);
  } catch {
    return null;
  }
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  const failedNames: string[] = [];
  uploadError.value = null;

  for (const file of files) {
    const result = await uploadOne(file);
    if (!result) {
      failedNames.push(file.name);
      continue;
    }
    uploadedPhotos.value = [...uploadedPhotos.value, result];
  }

  if (failedNames.length) {
    uploadError.value = `Failed to upload: ${failedNames.join(", ")}`;
  }

  // Reset so the same file can be selected again if needed
  input.value = "";
}

function handleSaveDraft(): void {
  saveDraft({ ...form.value, uploadedPhotos: uploadedPhotos.value });
}

function localDateToIso(dateString: string): string | undefined {
  if (!dateString) {
    return undefined;
  }
  // new Date(year, month-1, day) builds local midnight; .toISOString() converts
  // to UTC, preserving the semantic "this event happened on this calendar date
  // in the user's timezone."
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day).toISOString();
}

// Single isolated call site for POST /api/places. Takes the name explicitly so
// the persisted body and any staleness comparison can't drift from each other.
function createPlaceFromLocation(name: string): Promise<Place> {
  return placesStore.createPlace({ name: canonicalPlaceName(name) });
}

// True when this create still owns the active request (no reopen or newer create
// since) and the field still holds the name it submitted (no retype meanwhile).
function isCurrentCreate(token: number, requestedName: string): boolean {
  const fieldHolds =
    normalizePlaceName(form.value.location) ===
    normalizePlaceName(requestedName);
  return token === activeCreateToken && fieldHolds;
}

// Create the place for an explicit name under a caller-minted token and, when
// still current, adopt the canonical saved name. Throws on failure so each caller
// decides how to surface it. pendingCreateName blocks a second POST for the same
// name across a reopen (which resets the isCreatingPlace flag); the flag itself is
// reset only if this call still owns the active token.
async function runCreatePlace(
  requestToken: number,
  name: string,
): Promise<Place> {
  isCreatingPlace.value = true;
  createPlaceError.value = null;
  pendingCreateName = normalizePlaceName(name);
  try {
    const created = await createPlaceFromLocation(name);
    if (isCurrentCreate(requestToken, name)) {
      form.value.location = created.name;
    }
    return created;
  } finally {
    pendingCreateName = null;
    if (requestToken === activeCreateToken) {
      isCreatingPlace.value = false;
    }
  }
}

// Button handler: persist the typed location inline. No-op when the field is
// empty, already matches, a create is in flight (the disabled attribute lands a
// tick late, so this synchronous guard is what stops a double-click), or the same
// name is already being POSTed (survives a reopen that cleared the flag).
// Failures show inline, but only while this request still owns the form.
async function handleCreatePlace(): Promise<void> {
  const requestedName = form.value.location;
  const alreadyPosting =
    pendingCreateName === normalizePlaceName(requestedName);
  if (isCreatingPlace.value || alreadyPosting || !canCreatePlace.value) {
    return;
  }
  const requestToken = (activeCreateToken += 1);
  try {
    await runCreatePlace(requestToken, requestedName);
  } catch (caught) {
    if (isCurrentCreate(requestToken, requestedName)) {
      createPlaceError.value =
        caught instanceof Error ? caught.message : "Failed to create place";
    }
  }
}

// Snapshot the form synchronously (no placeId yet): publish resolves the place
// id over the network afterwards, and the title/body/tags/photo inputs are not
// disabled meanwhile, so reading them post-await could capture edits or a reset
// form. placeId is spread in once resolved.
function buildEntryPayload() {
  return {
    title: form.value.title,
    body: form.value.body || undefined,
    occurredAt: localDateToIso(form.value.date),
    tripId: form.value.tripId || undefined,
    tags: form.value.tags.length ? form.value.tags : undefined,
    photoMediaIds: uploadedPhotos.value.map((photo) => photo.id),
    visibility: form.value.visibility,
    weather: form.value.weather || undefined,
  };
}

// Re-fetch a stale/failed list once so we reuse an existing place instead of
// minting a duplicate of one we simply hadn't fetched. Writes the failure flag
// under its own load token so a late settle can't clobber a healthier later load.
async function settlePlacesList(): Promise<void> {
  const loadToken = (placesLoadToken += 1);
  try {
    await placesStore.fetchPlaces();
    if (loadToken === placesLoadToken) {
      placesLoadFailed.value = false;
    }
  } catch {
    // Now known-bad: the caller still creates anyway (the entry and its location
    // matter more than a possible dup against a list we can't read — the server
    // enforces no place-name uniqueness).
    if (loadToken === placesLoadToken) {
      placesLoadFailed.value = true;
    }
  }
}

// The id to attach for a snapshotted location (taken synchronously in publish so
// a mid-flight edit can't drift the name): an already-matched saved place, or one
// created now so the free text is never dropped. A create failure propagates to
// publish's catch and blocks the entry.
async function resolvePlaceId(location: string): Promise<string | undefined> {
  const existing = findSavedPlace(location);
  if (existing) {
    return existing.id;
  }
  if (!canonicalPlaceName(location)) {
    return undefined;
  }
  const listIsUntrustworthy = placesStore.isLoading || placesLoadFailed.value;
  if (listIsUntrustworthy) {
    await settlePlacesList();
  }
  const settledMatch = findSavedPlace(location);
  if (settledMatch) {
    return settledMatch.id;
  }
  const created = await runCreatePlace((activeCreateToken += 1), location);
  return created.id;
}

async function refreshEntriesNonFatal(): Promise<void> {
  try {
    await entriesStore.fetchEntries();
  } catch {
    // non-fatal: entry was created; list refreshes on next page load
  }
}

async function publish(): Promise<void> {
  // Synchronous re-entrancy guard: :disabled lands a tick late, so this is what
  // stops a double-click (or a create-then-publish in the same flush) creating
  // duplicate entries or places.
  if (isPublishing.value || isCreatingPlace.value) {
    return;
  }
  isPublishing.value = true;
  publishError.value = null;

  try {
    // Snapshot the entry (including the location) before any await so a mid-flight
    // edit or a reopen-triggered form reset can't corrupt what gets saved.
    const payload = buildEntryPayload();
    const locationSnapshot = form.value.location;

    // Resolve the place id: a typed-but-unsaved location is persisted here so it
    // attaches to the entry instead of being silently dropped. A failure throws
    // and is caught below, blocking the entry rather than saving it with the
    // location lost.
    const placeId = await resolvePlaceId(locationSnapshot);

    await entriesStore.createEntry({ ...payload, placeId });

    // Close first: once the entry is created, the drawer should close
    // regardless of whether the list refresh below succeeds.
    clearDraft();
    emit("close");

    await refreshEntriesNonFatal();
  } catch (caught) {
    publishError.value =
      caught instanceof Error
        ? caught.message
        : "Failed to publish. Please try again.";
  } finally {
    isPublishing.value = false;
  }
}
</script>
