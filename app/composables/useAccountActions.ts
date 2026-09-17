/**
 * Composable for account-management actions: password change, avatar, and
 * account deletion.
 *
 * All API calls go through `apiFetch` so the Clerk session token is injected
 * automatically.
 */
import { useApiClient } from "~/composables/useApiClient";
import { extractErrorMessage } from "~/utils/extractErrorMessage";

export function useAccountActions() {
  const { apiFetch } = useApiClient();
  const isLoading = ref(false);
  const passwordError = ref<string | null>(null);
  const avatarError = ref<string | null>(null);
  const deleteError = ref<string | null>(null);

  async function runAction<T>(
    action: () => Promise<T>,
    errorRef: ReturnType<typeof ref<string | null>>,
    fallback: T,
  ): Promise<T> {
    isLoading.value = true;
    errorRef.value = null;
    try {
      return await action();
    } catch (fetchError: unknown) {
      errorRef.value = extractErrorMessage(fetchError);
      return fallback;
    } finally {
      isLoading.value = false;
    }
  }

  async function changePassword(password: string): Promise<boolean> {
    return runAction(
      async () => {
        await apiFetch("/api/account/password", {
          method: "PATCH",
          body: { password },
        });
        return true;
      },
      passwordError,
      false,
    );
  }

  async function uploadAvatar(file: File): Promise<string | null> {
    return runAction(
      async () => {
        const result = await apiFetch<{ imageUrl: string | null }>(
          "/api/account/avatar",
          {
            method: "PATCH",
            headers: { "Content-Type": file.type },
            body: await file.arrayBuffer(),
          },
        );
        return result.imageUrl;
      },
      avatarError,
      null,
    );
  }

  async function removeAvatar(): Promise<boolean> {
    return runAction(
      async () => {
        await apiFetch("/api/account/avatar?action=remove", {
          method: "PATCH",
        });
        return true;
      },
      avatarError,
      false,
    );
  }

  async function deleteAccount(): Promise<boolean> {
    return runAction(
      async () => {
        await apiFetch("/api/account", { method: "DELETE" });
        // The server has already deleted the Clerk user, so the client's
        // cached session is already dead — sign out locally too so the UI
        // reflects that right away instead of showing stale signed-in
        // chrome until the next token refresh fails.
        const clerk = useClerk();
        await clerk.signOut({ redirectUrl: "/" });
        return true;
      },
      deleteError,
      false,
    );
  }

  return {
    isLoading: readonly(isLoading),
    passwordError: readonly(passwordError),
    avatarError: readonly(avatarError),
    deleteError: readonly(deleteError),
    changePassword,
    uploadAvatar,
    removeAvatar,
    deleteAccount,
  };
}
