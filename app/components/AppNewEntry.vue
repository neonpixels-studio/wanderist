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
          :disabled="isPublishing"
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
import { localDateToIso } from "~/utils/localDate";

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

    if (!tripsStore.tripList.length) {
      tripsStore.fetchTrips();
    }

    if (!placesStore.places.length) {
      placesStore.fetchPlaces();
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

async function refreshEntriesNonFatal(): Promise<void> {
  try {
    await entriesStore.fetchEntries();
  } catch {
    // non-fatal: entry was created; list refreshes on next page load
  }
}

async function publish(): Promise<void> {
  isPublishing.value = true;
  publishError.value = null;

  try {
    await entriesStore.createEntry(buildEntryPayload());

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
