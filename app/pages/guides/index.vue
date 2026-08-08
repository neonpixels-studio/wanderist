<template>
  <div class="content content--wide">
    <div class="guides-head">
      <div>
        <div class="label">// {{ guidesStore.guides.length }} guides</div>
        <h1>Your guides</h1>
        <p>Write up a route, a city, or a trick you always tell people.</p>
      </div>
      <button class="btn btn--outline" @click="openNewGuideForm">
        <AppIcon name="layers" :size="15" />
        new guide
      </button>
    </div>

    <!-- New guide form -->
    <GuideForm
      v-if="showNewGuideForm"
      title="New guide"
      submit-label="publish guide"
      :pending="isSavingGuide"
      :error="formError"
      @submit="handleCreateGuide"
      @cancel="closeNewGuideForm"
    />

    <!-- List load error -->
    <div v-if="guidesStore.error" class="alert alert--error" role="alert">
      {{ guidesStore.error }}
      <button class="btn btn--outline btn--sm" @click="loadGuides">
        retry
      </button>
    </div>

    <!-- Delete error (create/edit errors render inside GuideForm itself) -->
    <div v-if="deleteError" class="alert alert--error" role="alert">
      {{ deleteError }}
    </div>

    <GuidesList
      :guides="guidesStore.guides"
      :is-loading="guidesStore.isLoading"
      :has-loaded="guidesStore.hasLoaded"
      :editing-guide-id="editingGuideId"
      :deleting-guide-ids="deletingGuideIds"
      :liked-guide-ids="likedGuideIds"
      :is-saving-guide="isSavingGuide"
      :form-error="formError"
      @edit="startEditGuide"
      @delete="handleDeleteGuide"
      @toggle-like="handleToggleLikeGuide"
      @submit-edit="handleUpdateGuide"
      @cancel-edit="cancelEditGuide"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useGuidesStore } from "~/stores/guides";
import type {
  Guide,
  CreateGuideInput,
  UpdateGuideInput,
} from "~/stores/guides";
import { extractErrorMessage } from "~/utils/extractErrorMessage";
import GuideForm from "~/components/GuideForm.vue";
import GuidesList from "~/components/GuidesList.vue";

definePageMeta({ layout: "app", middleware: "auth" });
useHead({ title: "Wanderist — Guides" });

const guidesStore = useGuidesStore();

const showNewGuideForm = ref(false);
const editingGuideId = ref<string | null>(null);
const isSavingGuide = ref(false);
// A Set (not a single id) so an in-flight delete of one guide never blocks a
// delete of a different guide — each card's own in-flight state is looked up
// independently.
const deletingGuideIds = ref<Set<string>>(new Set());
// Tracks which guides the user has liked. Seeded from the server's
// `likedByCurrentUser` flag (guide_likes join table) on every fetch so the
// heart state survives a reload, then mutated optimistically on toggle.
// Mirrors likedEntryIds in pages/journal.vue.
const likedGuideIds = ref<Set<string>>(new Set());
// IDs whose like/unlike request is in flight. Excluded from seeding so a fetch
// that resolves mid-toggle can't overwrite the user's just-made choice.
const pendingLikeIds = ref<Set<string>>(new Set());
const formError = ref<string | null>(null);
const deleteError = ref<string | null>(null);

function openNewGuideForm(): void {
  editingGuideId.value = null;
  formError.value = null;
  deleteError.value = null;
  showNewGuideForm.value = true;
}

function closeNewGuideForm(): void {
  showNewGuideForm.value = false;
  formError.value = null;
}

function startEditGuide(guide: Guide): void {
  showNewGuideForm.value = false;
  formError.value = null;
  deleteError.value = null;
  editingGuideId.value = guide.id;
}

function cancelEditGuide(): void {
  editingGuideId.value = null;
  formError.value = null;
}

async function handleCreateGuide(input: CreateGuideInput): Promise<void> {
  isSavingGuide.value = true;
  formError.value = null;

  try {
    await guidesStore.createGuide(input);
    closeNewGuideForm();
  } catch (error) {
    formError.value = extractErrorMessage(error);
  } finally {
    isSavingGuide.value = false;
  }
}

async function handleUpdateGuide(
  guideId: string,
  input: UpdateGuideInput,
): Promise<void> {
  isSavingGuide.value = true;
  formError.value = null;

  try {
    await guidesStore.updateGuide(guideId, input);
    cancelEditGuide();
  } catch (error) {
    formError.value = extractErrorMessage(error);
  } finally {
    isSavingGuide.value = false;
  }
}

async function handleDeleteGuide(guide: Guide): Promise<void> {
  if (deletingGuideIds.value.has(guide.id)) {
    // A delete of this specific guide is already in flight — GuideCard
    // disables its confirm/cancel buttons while `deleting` is true, so this
    // only guards against an event that slips through before Vue re-renders
    // the disabled state. Deleting a *different* guide concurrently is fine
    // and not blocked by this check.
    return;
  }

  deletingGuideIds.value.add(guide.id);
  deleteError.value = null;

  try {
    await guidesStore.deleteGuide(guide.id);
  } catch (error) {
    deleteError.value = extractErrorMessage(error);
  } finally {
    deletingGuideIds.value.delete(guide.id);
  }
}

function setGuideLiked(guideId: string, liked: boolean): void {
  if (liked) {
    likedGuideIds.value.add(guideId);
    return;
  }
  likedGuideIds.value.delete(guideId);
}

// Re-sync the liked set from the server's per-row flag on every fetch, in both
// directions (a like removed elsewhere clears here too) — except for IDs with a
// toggle in flight, whose optimistic state must not be clobbered.
function seedLikedGuides(): void {
  for (const guide of guidesStore.guides) {
    if (pendingLikeIds.value.has(guide.id)) {
      continue;
    }
    setGuideLiked(guide.id, guide.likedByCurrentUser === true);
  }
}

async function handleToggleLikeGuide(guide: Guide): Promise<void> {
  const wasLiked = likedGuideIds.value.has(guide.id);
  const persist = wasLiked ? guidesStore.unlikeGuide : guidesStore.likeGuide;

  setGuideLiked(guide.id, !wasLiked);
  pendingLikeIds.value.add(guide.id);
  try {
    await persist(guide.id);
  } catch {
    // Rollback optimistic like state on failure so the heart matches what the
    // server actually recorded (the store leaves likeCount untouched on error).
    setGuideLiked(guide.id, wasLiked);
  } finally {
    pendingLikeIds.value.delete(guide.id);
  }
}

function loadGuides(): void {
  guidesStore.fetchGuides().catch((error) => {
    console.error("[guides] failed to load guides", error);
  });
}

// Re-seed whenever the guides list is (re)populated — the initial load, a
// retry, or any refetch — so the heart state always reflects the server.
watch(() => guidesStore.guides, seedLikedGuides);

onMounted(loadGuides);
</script>

<style scoped>
.guides-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}
.guides-head h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-top: 10px;
}
.guides-head p {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}
</style>
