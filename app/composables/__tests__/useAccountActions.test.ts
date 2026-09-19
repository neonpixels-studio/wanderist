/**
 * Unit tests for useAccountActions composable.
 *
 * `apiFetch` is mocked so no network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowRef } from "vue";
import { useAccountActions } from "../useAccountActions";

const mockApiFetch = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue(undefined);

vi.mock("~/composables/useApiClient", () => ({
  useApiClient: vi.fn(() => ({ apiFetch: mockApiFetch })),
}));

// useClerkInstance() mirrors the real @clerk/nuxt useClerk() composable's
// return shape (a ShallowRef<Clerk | null>), not a plain object — the code
// under test dereferences .value, and a mock shaped like a plain object
// would silently let that regress.
vi.stubGlobal(
  "useClerkInstance",
  vi.fn(() => shallowRef({ signOut: mockSignOut })),
);

describe("useAccountActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
  });

  describe("changePassword", () => {
    it("returns true and calls the correct endpoint on success", async () => {
      mockApiFetch.mockResolvedValue({ ok: true });
      const { changePassword } = useAccountActions();

      const result = await changePassword("newpassword123");

      expect(result).toBe(true);
      expect(mockApiFetch).toHaveBeenCalledWith("/api/account/password", {
        method: "PATCH",
        body: { password: "newpassword123" },
      });
    });

    it("returns false and sets passwordError on failure", async () => {
      mockApiFetch.mockRejectedValue(
        Object.assign(new Error("Nope"), {
          data: { statusMessage: "Password too weak" },
        }),
      );
      const { changePassword, passwordError } = useAccountActions();

      const result = await changePassword("weak");

      expect(result).toBe(false);
      expect(passwordError.value).toBe("Password too weak");
    });
  });

  describe("uploadAvatar", () => {
    it("returns imageUrl on success", async () => {
      mockApiFetch.mockResolvedValue({
        imageUrl: "https://cdn.clerk.com/avatar.jpg",
      });
      const { uploadAvatar } = useAccountActions();
      const file = new File(["data"], "avatar.jpg", { type: "image/jpeg" });

      const imageUrl = await uploadAvatar(file);

      expect(imageUrl).toBe("https://cdn.clerk.com/avatar.jpg");
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/account/avatar",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    it("returns null and sets avatarError on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Upload failed"));
      const { uploadAvatar, avatarError } = useAccountActions();
      const file = new File(["data"], "avatar.jpg", { type: "image/jpeg" });

      const imageUrl = await uploadAvatar(file);

      expect(imageUrl).toBeNull();
      expect(avatarError.value).toBe("Upload failed");
    });
  });

  describe("removeAvatar", () => {
    it("returns true on success and calls the remove endpoint", async () => {
      mockApiFetch.mockResolvedValue({ ok: true });
      const { removeAvatar } = useAccountActions();

      const result = await removeAvatar();

      expect(result).toBe(true);
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/account/avatar?action=remove",
        { method: "PATCH" },
      );
    });

    it("returns false and sets avatarError on failure", async () => {
      mockApiFetch.mockRejectedValue(new Error("Remove failed"));
      const { removeAvatar, avatarError } = useAccountActions();

      const result = await removeAvatar();

      expect(result).toBe(false);
      expect(avatarError.value).toBe("Remove failed");
    });
  });

  describe("deleteAccount", () => {
    it("returns true on success and calls the delete endpoint", async () => {
      mockApiFetch.mockResolvedValue({ ok: true });
      const { deleteAccount } = useAccountActions();

      const result = await deleteAccount();

      expect(result).toBe(true);
      expect(mockApiFetch).toHaveBeenCalledWith("/api/account", {
        method: "DELETE",
      });
    });

    it("signs the client out and redirects home after a successful delete", async () => {
      mockApiFetch.mockResolvedValue({ ok: true });
      const { deleteAccount } = useAccountActions();

      const result = await deleteAccount();

      expect(result).toBe(true);
      expect(mockSignOut).toHaveBeenCalledWith({ redirectUrl: "/" });
    });

    it("still reports success when the local sign-out fails", async () => {
      // The server has already deleted the Clerk user by the time signOut()
      // runs, so a failure here is only stale client-side state — it must
      // not flip a real deletion back into a reported failure, which would
      // reopen the delete flow for an account that no longer exists.
      mockApiFetch.mockResolvedValue({ ok: true });
      mockSignOut.mockRejectedValueOnce(new Error("network"));
      const { deleteAccount, deleteError } = useAccountActions();

      const result = await deleteAccount();

      expect(result).toBe(true);
      expect(deleteError.value).toBeNull();
    });

    it("falls back to a plain redirect when Clerk has not loaded yet", async () => {
      // clerk.value is null until the Clerk plugin finishes loading (see
      // useClerkInstance's real @clerk/nuxt return type: ShallowRef<Clerk |
      // null>). This must not be treated as a signOut() failure — there's no
      // instance to call it on — but it still needs to get the user off the
      // now-deleted account's page.
      vi.mocked(globalThis.useClerkInstance).mockReturnValueOnce(
        shallowRef(null),
      );
      mockApiFetch.mockResolvedValue({ ok: true });
      const { deleteAccount, deleteError } = useAccountActions();

      const result = await deleteAccount();

      expect(result).toBe(true);
      expect(deleteError.value).toBeNull();
      expect(navigateTo).toHaveBeenCalledWith("/");
    });

    it("returns false and sets deleteError on failure", async () => {
      mockApiFetch.mockRejectedValue(
        Object.assign(new Error("Failed"), {
          data: { statusMessage: "Account not found" },
        }),
      );
      const { deleteAccount, deleteError } = useAccountActions();

      const result = await deleteAccount();

      expect(result).toBe(false);
      expect(deleteError.value).toBe("Account not found");
    });

    it("does not sign the client out when the delete request fails", async () => {
      mockApiFetch.mockRejectedValue(new Error("Failed"));
      const { deleteAccount } = useAccountActions();

      await deleteAccount();

      expect(mockSignOut).not.toHaveBeenCalled();
    });
  });

  describe("isLoading", () => {
    it("is true during an in-flight request and false after", async () => {
      let resolve!: () => void;
      mockApiFetch.mockReturnValue(
        new Promise<void>((r) => {
          resolve = r;
        }),
      );

      const { changePassword, isLoading } = useAccountActions();
      const promise = changePassword("longpassword");

      expect(isLoading.value).toBe(true);
      resolve();
      await promise;
      expect(isLoading.value).toBe(false);
    });

    it("stays true through the post-delete sign-out call, not just the DELETE request", async () => {
      // Regression guard: the delete button disables on isLoading, and
      // deleteAccount() does an apiFetch DELETE *then* an async sign-out.
      // If isLoading dropped to false between those two steps, a second
      // click could fire a second DELETE against an already-deleted account.
      mockApiFetch.mockResolvedValue({ ok: true });
      let resolveSignOut!: () => void;
      mockSignOut.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
      );

      const { deleteAccount, isLoading } = useAccountActions();
      const promise = deleteAccount();
      await Promise.resolve(); // let the DELETE call's microtask settle

      expect(isLoading.value).toBe(true);
      resolveSignOut();
      await promise;
      expect(isLoading.value).toBe(false);
    });
  });
});
