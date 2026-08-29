<template>
  <div
    v-if="open"
    class="drawer new-entry is-open"
    role="dialog"
    :aria-label="isEditing ? 'Edit entry' : 'New entry'"
  >
    <div class="drawer__scrim" @click="!isPublishing && emit('close')" />
    <aside class="drawer__panel">
      <header class="drawer__head">
        <div>
          <div class="label">
            // {{ isEditing ? "edit entry" : "new entry" }}
          </div>
          <h3 class="display" style="font-size: 18px; margin-top: 6px">
            {{ isEditing ? "Edit this moment" : "Capture a moment" }}
          </h3>
        </div>
        <button
          class="icon-btn"
          aria-label="Close"
          :disabled="isPublishing"
          @click="emit('close')"
        >
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
                v-if="photo.url"
                :src="photo.url"
                alt=""
                style="width: 100%; height: 100%; object-fit: cover"
              />
              <div v-else class="topo" />
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
          <p v-if="uploadError" class="error-hint" data-test="upload-error">
            {{ uploadError }}
          </p>
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
        <AppNewEntryLocationField
          v-model="form.location"
          :suggestions="placeSuggestions"
          :can-create-place="canCreatePlace"
          :is-creating-place="isCreatingPlace"
          :create-place-error="createPlaceError"
          :places-load-failed="placesLoadFailed"
          :canonical-location="canonicalLocation"
          @select="selectPlace"
          @create="handleCreatePlace"
        />

        <!-- Trip -->
        <div class="field">
          <label class="field__label">Trip</label>
          <div class="pill-pick">
            <button
              v-for="trip in tripOptions"
              :key="trip.value"
              class="pick"
              :class="{ 'is-active': form.tripId === trip.value }"
              :disabled="isTripOptionDisabled(trip.value)"
              :title="
                isTripOptionDisabled(trip.value)
                  ? 'A trip can’t be removed while editing'
                  : undefined
              "
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

        <p v-if="publishError" class="error-hint" data-test="publish-error">
          {{ publishError }}
        </p>
      </div>

      <footer class="drawer__foot">
        <button
          v-if="!isEditing"
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
          {{ primaryActionLabel }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { Trip } from "~/stores/trips";
import type { Entry } from "~/stores/entries";
import type { Place } from "~/stores/places";
import AppNewEntryLocationField from "~/components/AppNewEntryLocationField.vue";

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

interface PlaceSuggestion {
  id: string;
  name: string;
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

const props = withDefaults(
  defineProps<{ open: boolean; entry?: Entry | null }>(),
  { entry: null },
);
const emit = defineEmits<{ close: [] }>();

// Truthy-based so it agrees with seedFormForCurrentMode's `if (props.entry)`
// branch: a null or undefined entry is create mode on both paths.
const isEditing = computed(() => Boolean(props.entry));

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
// A re-seed requested while a save was in flight is deferred, then replayed once
// the save settles (see the open watcher and publish's finally).
const reseedPending = ref(false);

const primaryActionLabel = computed(() => {
  if (isPublishing.value) {
    return isEditing.value ? "saving…" : "publishing…";
  }
  return isEditing.value ? "save changes" : "publish";
});

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
// isCreatingPlace flag on a fresh form. The inline error message uses the same
// check (isCurrentCreate: token AND name), so a create rejected after a reopen
// that restored its exact name still can't stamp a stale error on the fresh form.
let activeCreateToken = 0;

// Normalized name of an in-flight place POST, or null. Survives a reopen (which
// resets isCreatingPlace) so the same name can't be created twice concurrently.
let pendingCreateName: string | null = null;

// Resolves once the places prefetch for this open has settled. `persistEntry`
// awaits it before resolving a typed location's placeId, so a location entered
// during the cold-store load window is not dropped for want of a loaded list.
// Stays already-resolved when the store was warm, so a warm save never waits.
const placesReady = ref<Promise<unknown>>(Promise.resolve());

// One-shot flag: true once the default tripId has been applied, so a later
// trips-store update does not clobber an explicit "None" selection.
const tripDefaulted = ref(false);

function localIsoDate(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

// Inverse of localDateToIso: read an entry's stored occurredAt back into the
// date input's local YYYY-MM-DD, so editing then re-saving round-trips the same
// calendar date instead of shifting it by the UTC offset.
function isoToLocalDate(iso: string): string {
  const date = new Date(iso);

  // A malformed occurredAt would yield "NaN-NaN-NaN", which the date input
  // silently rejects and blanks; fall back to today so the field stays valid.
  if (Number.isNaN(date.getTime())) {
    return localIsoDate();
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

// The place the user explicitly picked from the suggestions, if any. Held
// separately from the free-text location so a chip choice survives even when
// two places share a name (resolving by name alone couldn't disambiguate).
const selectedPlace = ref<PlaceSuggestion | null>(null);

function applyFreshForm(): void {
  form.value = buildInitialForm(tripsStore.tripList);
  selectedPlace.value = null;
  uploadedPhotos.value = [];
  if (form.value.tripId !== NO_TRIP_VALUE) {
    tripDefaulted.value = true;
  }
}

function buildFormFromEntry(entry: Entry): FormState {
  return {
    title: entry.title,
    body: entry.body ?? "",
    location: "",
    tripId: entry.tripId ?? NO_TRIP_VALUE,
    date: entry.occurredAt ? isoToLocalDate(entry.occurredAt) : localIsoDate(),
    visibility: entry.visibility,
    tags: entry.tags.map((tag) => tag.name),
    weather: entry.weather ?? "",
  };
}

// Existing photos carry only a mediaId (no URL on the entry resource), so they
// seed the uploader with an empty url and render as a placeholder. Keeping them
// in uploadedPhotos means the save payload preserves them — the PATCH replaces
// the whole photo set, so dropping them here would silently delete the photos.
function applyEntryForm(entry: Entry): void {
  form.value = buildFormFromEntry(entry);
  uploadedPhotos.value = entry.photos.map((photo) => ({
    id: photo.mediaId,
    url: "",
  }));
  // Edit opens with an empty location field, so drop any place chosen in a
  // prior create session — a stale chip choice must not leak into this entry.
  selectedPlace.value = null;
  // The entry's trip is an explicit choice; guard it from the trips-load watch.
  tripDefaulted.value = true;
}

const tripOptions = computed<TripOption[]>(() => {
  const options = tripsStore.tripList.map((trip) => ({
    value: trip.id,
    label: trip.name,
  }));
  return [...options, { value: NO_TRIP_VALUE, label: "None" }];
});

// Editing can reassign to another trip but cannot detach to None: the PATCH has
// no "clear the trip" input (an omitted/empty tripId reads as "leave
// unchanged"). Keep None visible so a trip-less entry still shows its state, but
// disable it while editing rather than promise a detach the API can't perform.
function isTripOptionDisabled(tripValue: string): boolean {
  return (
    isEditing.value &&
    tripValue === NO_TRIP_VALUE &&
    Boolean(props.entry?.tripId)
  );
}

const placeSuggestions = computed<PlaceSuggestion[]>(() =>
  placesStore.places
    .map((place) => ({ id: place.id, name: place.name }))
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

// The user typed a location that matches nothing we know about. Gates the
// inline-create affordance; it is independent of list trustworthiness.
const hasUnsavedLocation = computed<boolean>(
  () => trimmedLocation.value.length > 0 && matchedPlace.value === null,
);

// Offer the inline affordance only when the places list is trustworthy: a
// not-yet-fetched or failed-to-fetch list can't back the "no saved place
// matches" claim, so hide the button (publish still persists the typed location
// via resolveOrCreatePlaceId, so nothing is lost).
const canCreatePlace = computed<boolean>(
  () =>
    hasUnsavedLocation.value &&
    !placesStore.isLoading &&
    !placesLoadFailed.value,
);

// An explicit chip choice is honoured while the text still names it, but only
// as long as the place still exists: once places load, a chosen id absent from
// the list (place deleted, or a draft from another user) must not be trusted —
// the server would reject it — so we fall back to name resolution instead.
function chosenMatchesLocation(place: PlaceSuggestion): boolean {
  if (
    normalizePlaceName(form.value.location) !== normalizePlaceName(place.name)
  ) {
    return false;
  }
  if (!placesStore.places.length) {
    return true;
  }
  return placesStore.places.some((candidate) => candidate.id === place.id);
}

// The saved place id this entry resolves to synchronously: an explicit chip
// choice wins while it holds, otherwise the typed location matched by name.
// Empty when nothing matches yet — publish then creates the typed location
// inline (see resolveOrCreatePlaceId) so free text is never dropped.
const resolvedPlaceId = computed<string>(() => {
  const chosen = selectedPlace.value;
  if (chosen && chosenMatchesLocation(chosen)) {
    return chosen.id;
  }
  return findSavedPlace(form.value.location)?.id ?? "";
});

// Picking a suggestion captures the place directly, so the entry is attached
// to exactly the place the user chose even when place names collide.
function selectPlace(place: PlaceSuggestion): void {
  form.value.location = place.name;
  selectedPlace.value = place;
}

function selectTrip(tripId: string): void {
  form.value.tripId = tripId;
  // Mark as explicitly chosen so the tripList watch no longer overrides it
  tripDefaulted.value = true;
}

function applyDraftOrFreshForm(): void {
  tripDefaulted.value = false;

  const draft = loadDraft();

  if (!draft) {
    applyFreshForm();
    return;
  }

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
  // Restore the saved place choice so it survives the round-trip. A draft
  // written before placeId existed has none; `resolvedPlaceId` then falls
  // back to resolving the name once places load.
  selectedPlace.value = draft.placeId
    ? { id: draft.placeId, name: draft.location }
    : null;
  uploadedPhotos.value = draft.uploadedPhotos ?? [];
  // Treat a restored draft's tripId as already-defaulted so it is preserved
  tripDefaulted.value = true;
}

function ensureReferenceData(): void {
  if (!tripsStore.tripList.length) {
    tripsStore.fetchTrips();
  }

  // Mint the token unconditionally so a reopen that skips the fetch (because the
  // list is already populated) still invalidates any earlier in-flight load,
  // stopping its late failure from marking a now-healthy list as failed.
  placesLoadFailed.value = false;
  const loadToken = (placesLoadToken += 1);
  if (placesStore.places.length) {
    placesReady.value = Promise.resolve();
    return;
  }

  const fetchPromise = placesStore.fetchPlaces();
  // Track load failure locally so the affordance can hide, scoped by token so
  // only the latest load writes the flag. Publish still persists via the
  // resolveOrCreatePlaceId path, so a failed load never drops a typed location.
  // Kept on its own chain, separate from placesReady, so awaiting the load
  // (persistEntry) costs a single microtask hop rather than this chain too.
  fetchPromise
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
  // Held so persistEntry can await the in-flight load before resolving a placeId.
  placesReady.value = fetchPromise.catch(() => {});
}

// Keyed on the entry's identity (id) as well as open: the drawer is a single
// shared instance, so switching between create and edit (or between two
// entries) while it stays open must re-seed the form. Watching only `open`
// would leave stale edit data in a now-create drawer and let "publish"
// duplicate the entry being edited. Keying on `id` rather than the object
// reference means a background refetch that swaps in an equal entry object does
// not blow away an in-progress edit.
watch(
  [() => props.open, () => props.entry?.id ?? null],
  ([isOpen]) => {
    if (!isOpen) {
      return;
    }

    // A save reads form state after an await (place resolution) and PATCHes it
    // under the snapshotted id. Re-seeding mid-save would swap that state out — e.g. a
    // ⌘K "new entry" nulls props.entry while an edit is in flight — and write the
    // replacement content over the edited entry. Defer the re-seed and replay it
    // once the save settles, so the (rare) error path doesn't strand the drawer
    // in a stale mode.
    if (isPublishing.value) {
      reseedPending.value = true;
      return;
    }

    seedFormForCurrentMode();
  },
  { immediate: true },
);

function seedFormForCurrentMode(): void {
  // Editing pre-fills from the entry and ignores the create-only draft.
  if (props.entry) {
    applyEntryForm(props.entry);
  } else {
    applyDraftOrFreshForm();
  }

  tagInput.value = "";
  publishError.value = null;
  uploadError.value = null;
  createPlaceError.value = null;
  isCreatingPlace.value = false;
  activeCreateToken += 1;

  ensureReferenceData();
}

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
  saveDraft({
    ...form.value,
    placeId: resolvedPlaceId.value,
    uploadedPhotos: uploadedPhotos.value,
  });
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
    // Only clear the marker this call set: an overlapping create for a different
    // name may own it now, and nulling it unconditionally would leave that one
    // unguarded against a duplicate POST.
    if (pendingCreateName === normalizePlaceName(name)) {
      pendingCreateName = null;
    }
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

// isEdit is passed in rather than read from props.entry: publish() snapshots the
// mode before awaiting, and the parent can null props.entry mid-save. Reading it
// live here would misclassify an in-flight edit as a create and drop the
// verbatim-clear fields, silently reverting the user's deletions. placeId is
// spread in by persistEntry once resolved, so it is deliberately absent here.
function buildEntryPayload(isEdit: boolean) {
  const shared = {
    title: form.value.title,
    occurredAt: localDateToIso(form.value.date),
    tripId: form.value.tripId || undefined,
    photoMediaIds: uploadedPhotos.value.map((photo) => photo.id),
    visibility: form.value.visibility,
  };

  // Editing sends body/weather/tags verbatim so clearing a field actually
  // persists the clear ("" / []); the PATCH route treats an omitted key as
  // "leave unchanged", which would silently revert a deletion. The create path
  // keeps them optional so a blank new entry omits them entirely.
  if (isEdit) {
    return {
      ...shared,
      body: form.value.body,
      weather: form.value.weather,
      tags: form.value.tags,
    };
  }

  return {
    ...shared,
    body: form.value.body || undefined,
    tags: form.value.tags.length ? form.value.tags : undefined,
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
async function resolveOrCreatePlaceId(
  location: string,
): Promise<string | undefined> {
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

async function persistEntry(
  editedEntryId: string | null,
  locationSnapshot: string,
): Promise<void> {
  if (editedEntryId) {
    // Editing resolves a place synchronously (an explicit chip choice or an exact
    // saved match) and never inline-creates one: the edit form opens with an empty
    // location, and the PATCH reads an omitted placeId as "leave unchanged". A
    // location typed during the cold-store load window can only match once the
    // list arrives, so wait for the in-flight fetch before resolving it.
    if (locationSnapshot.trim()) {
      await placesReady.value;
    }
    const editPayload = buildEntryPayload(true);
    await entriesStore.updateEntry(editedEntryId, {
      ...editPayload,
      placeId: resolvedPlaceId.value || undefined,
    });
    return;
  }

  // Creating resolves the place id: an explicit chip choice or an exact saved
  // match is taken synchronously (resolvedPlaceId); otherwise a typed-but-unsaved
  // location is created inline so it attaches to the entry instead of being
  // silently dropped. resolveOrCreatePlaceId settles an untrustworthy list itself,
  // so the create path needs no separate placesReady await. A create failure
  // throws and is caught by publish, blocking the entry rather than losing the
  // location.
  const createPayload = buildEntryPayload(false);
  const placeId =
    resolvedPlaceId.value || (await resolveOrCreatePlaceId(locationSnapshot));
  await entriesStore.createEntry({
    ...createPayload,
    placeId: placeId || undefined,
  });
}

// The message shown when a save fails: the server's own error when it threw one,
// otherwise a mode-specific fallback (edit vs create).
function publishFailureMessage(
  caught: unknown,
  editedEntryId: string | null,
): string {
  if (caught instanceof Error) {
    return caught.message;
  }
  return editedEntryId
    ? "Failed to save changes. Please try again."
    : "Failed to publish. Please try again.";
}

async function publish(): Promise<void> {
  // Synchronous re-entrancy guard: :disabled lands a tick late, so this is what
  // stops a double-click (or a create-then-publish in the same flush) creating
  // duplicate entries or places.
  if (isPublishing.value || isCreatingPlace.value) {
    return;
  }
  // Snapshot the mode before any await: a mid-save close resets props.entry to
  // null, and reading it afterward would misclassify an in-flight edit as a
  // create and clear an unrelated saved draft.
  const editedEntryId = props.entry?.id ?? null;
  isPublishing.value = true;
  publishError.value = null;

  try {
    // Snapshot the location before any await so a mid-flight edit or a
    // reopen-triggered form reset can't corrupt what gets saved.
    const locationSnapshot = form.value.location;

    await persistEntry(editedEntryId, locationSnapshot);

    // Close first: once the entry is saved, the drawer should close regardless
    // of whether the list refresh below succeeds. The draft is a create-only
    // concept, so editing leaves any unrelated saved draft untouched.
    if (!editedEntryId) {
      clearDraft();
    }
    emit("close");
  } catch (caught) {
    publishError.value = publishFailureMessage(caught, editedEntryId);
  } finally {
    isPublishing.value = false;
    replayDeferredReseed();
  }

  // The list refresh is non-fatal and unrelated to the drawer, so it runs
  // outside the publishing window — holding isPublishing across a network round
  // trip would make a drawer reopened mid-refresh render stale content in a dead
  // "saving…" state. A failed save recorded an error and has nothing new to show.
  if (!publishError.value) {
    await refreshEntriesNonFatal();
  }
}

// Replay a re-seed that was deferred during the save. On success the drawer has
// closed (props.open false), so this only fires on the error path, where
// props.entry/open changed mid-save and the form must catch up to it.
function replayDeferredReseed(): void {
  if (!reseedPending.value) {
    return;
  }
  reseedPending.value = false;
  if (!props.open) {
    return;
  }
  // Seeding clears publishError; carry a save failure across so the drawer the
  // user is now looking at still surfaces it rather than silently discarding it.
  const carriedError = publishError.value;
  seedFormForCurrentMode();
  publishError.value = carriedError;
}
</script>
