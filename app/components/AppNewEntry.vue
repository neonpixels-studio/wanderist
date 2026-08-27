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
          :disabled="isPublishing"
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

const props = withDefaults(
  defineProps<{ open: boolean; entry?: Entry | null }>(),
  { entry: null },
);
const emit = defineEmits<{ close: [] }>();

const isEditing = computed(() => props.entry !== null);

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

const primaryActionLabel = computed(() => {
  if (isPublishing.value) {
    return isEditing.value ? "saving…" : "publishing…";
  }
  return isEditing.value ? "save changes" : "publish";
});

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

function applyFreshForm(): void {
  form.value = buildInitialForm(tripsStore.tripList);
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

const locationSuggestions = computed<string[]>(() =>
  placesStore.places
    .map((place) => place.name)
    .slice(0, MAX_LOCATION_SUGGESTIONS),
);

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
  uploadedPhotos.value = draft.uploadedPhotos ?? [];
  // Treat a restored draft's tripId as already-defaulted so it is preserved
  tripDefaulted.value = true;
}

function ensureReferenceData(): void {
  if (!tripsStore.tripList.length) {
    tripsStore.fetchTrips();
  }

  if (!placesStore.places.length) {
    placesStore.fetchPlaces();
  }
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

    // Editing pre-fills from the entry and ignores the create-only draft.
    if (props.entry) {
      applyEntryForm(props.entry);
    } else {
      applyDraftOrFreshForm();
    }

    tagInput.value = "";
    publishError.value = null;
    uploadError.value = null;

    ensureReferenceData();
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

function buildEntryPayload() {
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
  if (props.entry) {
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

async function refreshEntriesNonFatal(): Promise<void> {
  try {
    await entriesStore.fetchEntries();
  } catch {
    // non-fatal: entry was created; list refreshes on next page load
  }
}

async function persistEntry(editedEntryId: string | null): Promise<void> {
  const payload = buildEntryPayload();

  if (editedEntryId) {
    await entriesStore.updateEntry(editedEntryId, payload);
    return;
  }

  await entriesStore.createEntry(payload);
}

async function publish(): Promise<void> {
  // Snapshot the mode before any await: a mid-save close resets props.entry to
  // null, and reading it afterward would misclassify an in-flight edit as a
  // create and clear an unrelated saved draft.
  const editedEntryId = props.entry?.id ?? null;
  isPublishing.value = true;
  publishError.value = null;

  try {
    await persistEntry(editedEntryId);

    // Close first: once the entry is saved, the drawer should close regardless
    // of whether the list refresh below succeeds. The draft is a create-only
    // concept, so editing leaves any unrelated saved draft untouched.
    if (!editedEntryId) {
      clearDraft();
    }
    emit("close");

    await refreshEntriesNonFatal();
  } catch (caught) {
    const fallbackMessage = editedEntryId
      ? "Failed to save changes. Please try again."
      : "Failed to publish. Please try again.";
    publishError.value =
      caught instanceof Error ? caught.message : fallbackMessage;
  } finally {
    isPublishing.value = false;
  }
}
</script>
