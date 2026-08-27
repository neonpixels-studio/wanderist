<template>
  <div class="shell" :data-auth-ready="isLoaded">
    <div
      class="scrim"
      :class="{ 'is-open': sidebarOpen }"
      @click="sidebarOpen = false"
    />
    <AppSidebar :is-open="sidebarOpen" @close="sidebarOpen = false" />
    <div class="main">
      <slot />
    </div>
    <AppNewEntry
      :open="newEntryOpen"
      :entry="editingEntry"
      @close="closeNewEntry"
    />
    <AppNotifications
      :open="notificationsOpen"
      @close="notificationsOpen = false"
    />
    <AppCommandPalette
      :open="commandPaletteOpen"
      @close="commandPaletteOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import type { Entry, EditEntryHandler } from "~/stores/entries";

// Auth resolves client-side only (Clerk's skipServerMiddleware: true), so this
// SSR-rendered shell is interactive-looking before Clerk finishes loading and
// its watchers/redirects settle. Exposing isLoaded as a data attribute gives
// e2e tests a real "safe to interact" signal instead of racing on paint.
const { isLoaded } = useClerkAuth();

const sidebarOpen = ref(false);
const newEntryOpen = ref(false);
const notificationsOpen = ref(false);
const commandPaletteOpen = ref(false);

// The entry being edited, or null for a fresh "new entry". The drawer switches
// to edit mode when this is set; both open paths reset it so the mode is never
// stale.
const editingEntry = ref<Entry | null>(null);

function closeNewEntry(): void {
  newEntryOpen.value = false;
  editingEntry.value = null;
}

provide("openSidebar", () => {
  sidebarOpen.value = true;
});

provide("openNewEntry", () => {
  editingEntry.value = null;
  newEntryOpen.value = true;
});

const openEditEntry: EditEntryHandler = (entry) => {
  editingEntry.value = entry;
  newEntryOpen.value = true;
};
provide("openEditEntry", openEditEntry);

provide("openNotifications", () => {
  notificationsOpen.value = true;
});

provide("openCommandPalette", () => {
  commandPaletteOpen.value = true;
});

useCommandPaletteShortcut(() => {
  commandPaletteOpen.value = true;
});
</script>
