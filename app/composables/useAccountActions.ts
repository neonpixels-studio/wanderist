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
  // Must be read synchronously here, during setup — useClerkInstance() (like
  // any Clerk composable) relies on Vue's injection context, which is gone
  // by the time an async action like deleteAccount() resumes after an await.
  const clerk = useClerkInstance();
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

  // The server has already deleted the Clerk user by the time this runs, so
  // the client's cached session is already dead — sign out locally too so
  // the UI reflects that right away instead of showing stale signed-in
  // chrome until the next token refresh fails. This is best-effort client
  // cleanup only: it swallows its own failures (including Clerk not having
  // loaded yet, when clerk.value is still null) and falls back to a plain
  // navigation home, since by the time it runs the account deletion has
  // already succeeded and nothing here should be able to report otherwise.
  async function signOutLocally(): Promise<void> {
    const clerkInstance = clerk.value;
    if (!clerkInstance) {
      await navigateTo("/");
      return;
    }
    try {
      await clerkInstance.signOut({ redirectUrl: "/" });
    } catch {
      await navigateTo("/");
    }
  }

  async function deleteAccount(): Promise<boolean> {
    return runAction(
      async () => {
        await apiFetch("/api/account", { method: "DELETE" });
        // Kept inside this action (and therefore inside runAction's
        // isLoading window) so the delete button/modal stay disabled for
        // the full round trip, not just the initial DELETE — otherwise a
        // second click during the sign-out call would fire a second DELETE
        // against an account that's already gone.
        await signOutLocally();
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
