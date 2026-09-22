/**
 * Composable for managing connected third-party accounts.
 *
 * Wraps the /api/connections/* endpoints and exposes reactive state for
 * Instagram and Google connection status. Follows the same pattern as
 * usePreferences: apiFetch for auth, useState for SSR-safe shared state.
 */

import { useApiClient } from "~/composables/useApiClient";
import { extractErrorMessage } from "~/utils/extractErrorMessage";

export interface InstagramConnectionState {
  connected: boolean;
}

export interface GoogleConnectionState {
  connected: boolean;
  emailAddress: string | null;
  identificationId: string | null;
}

export interface ConnectionsState {
  instagram: InstagramConnectionState;
  google: GoogleConnectionState;
}

export interface InstagramImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  // The import is bounded per run; `hasMore` is true when items remain and the
  // client should call the endpoint again to resume. `remaining` is how many
  // new items were deferred to a later run.
  hasMore: boolean;
  remaining: number;
}

export type ImportAlertIntent = "success" | "warning" | "error" | "info";

/**
 * Derives the user-facing alert copy and intent for an import result. Pure and
 * exported so the branch logic (partial success, resume hint, intent choice)
 * is unit-tested without mounting the settings page.
 */
export function describeInstagramImportResult(result: InstagramImportResult): {
  message: string;
  intent: ImportAlertIntent;
} {
  const photoCount = result.imported;
  const summary = `Imported ${photoCount} photo${photoCount === 1 ? "" : "s"}`;
  const resumeHint = result.hasMore
    ? ` ${result.remaining} more remain${result.remaining === 1 ? "s" : ""}, run import again to continue.`
    : "";

  if (result.errors.length === 0) {
    // A run that imported nothing but still has work queued (e.g. the time
    // budget ran out mid-walk) is in-progress, not a completed success.
    const intent: ImportAlertIntent =
      photoCount === 0 && result.hasMore ? "info" : "success";
    return { message: `${summary}.${resumeHint}`, intent };
  }

  const errorCount = result.errors.length;
  // "error" only for the terminal zero-progress case (nothing imported and no
  // resume queued); if work still remains it's a "warning" the user can act on.
  const intent: ImportAlertIntent =
    photoCount === 0 && !result.hasMore ? "error" : "warning";

  // When the resume hint is suppressed (the whole attempted batch failed) but
  // items were never reached, name them so they aren't silently dropped.
  const untouched = result.remaining - errorCount;
  if (!result.hasMore && untouched > 0) {
    return {
      message: `${summary}, ${errorCount} failed. ${untouched} still pending.`,
      intent,
    };
  }

  return { message: `${summary}, ${errorCount} failed.${resumeHint}`, intent };
}

const CONNECTIONS_DEFAULTS: ConnectionsState = {
  instagram: { connected: false },
  google: { connected: false, emailAddress: null, identificationId: null },
};

export function useConnections() {
  const { apiFetch } = useApiClient();

  const connections = useState<ConnectionsState>("connections-state", () => ({
    ...CONNECTIONS_DEFAULTS,
    instagram: { ...CONNECTIONS_DEFAULTS.instagram },
    google: { ...CONNECTIONS_DEFAULTS.google },
  }));

  const isLoading = ref(false);
  const loadError = ref<string | null>(null);
  const actionError = ref<string | null>(null);
  const importResult = ref<InstagramImportResult | null>(null);

  async function fetchConnections(): Promise<void> {
    isLoading.value = true;
    loadError.value = null;

    try {
      const [instagram, google] = await Promise.all([
        apiFetch<InstagramConnectionState>("/api/connections/instagram"),
        apiFetch<GoogleConnectionState>("/api/connections/google"),
      ]);
      connections.value.instagram = instagram;
      connections.value.google = google;
    } catch (error: unknown) {
      loadError.value = extractErrorMessage(error);
    } finally {
      isLoading.value = false;
    }
  }

  function startInstagramConnect(): void {
    // Navigates the top-level window to the OAuth start endpoint, which sets
    // the state cookie and redirects to Instagram. The callback redirects back
    // to /settings?connection=instagram_success#connections.
    window.location.href = "/api/connections/instagram/start";
  }

  async function disconnectInstagram(): Promise<boolean> {
    actionError.value = null;
    try {
      await apiFetch("/api/connections/instagram", { method: "DELETE" });
      connections.value.instagram = { connected: false };
      return true;
    } catch (error: unknown) {
      actionError.value = extractErrorMessage(error);
      return false;
    }
  }

  async function disconnectGoogle(): Promise<boolean> {
    actionError.value = null;
    const { identificationId } = connections.value.google;
    if (!identificationId) {
      actionError.value = "No Google account connected";
      return false;
    }
    try {
      await apiFetch("/api/connections/google", {
        method: "DELETE",
        body: { identificationId },
      });
      connections.value.google = {
        connected: false,
        emailAddress: null,
        identificationId: null,
      };
      return true;
    } catch (error: unknown) {
      actionError.value = extractErrorMessage(error);
      return false;
    }
  }

  async function importInstagramPhotos(): Promise<boolean> {
    actionError.value = null;
    importResult.value = null;
    try {
      const result = await apiFetch<InstagramImportResult>(
        "/api/connections/instagram/import",
        { method: "POST" },
      );
      importResult.value = result;
      return true;
    } catch (error: unknown) {
      actionError.value = extractErrorMessage(error);
      return false;
    }
  }

  return {
    connections: readonly(connections),
    isLoading: readonly(isLoading),
    loadError: readonly(loadError),
    actionError: readonly(actionError),
    importResult: readonly(importResult),
    fetchConnections,
    startInstagramConnect,
    disconnectInstagram,
    disconnectGoogle,
    importInstagramPhotos,
  };
}
