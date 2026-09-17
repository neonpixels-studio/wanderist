/**
 * Unit tests for useAccountActions composable.
 *
 * `apiFetch` is mocked so no network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAccountActions } from "../useAccountActions";

const mockApiFetch = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue(undefined);

vi.mock("~/composables/useApiClient", () => ({
  useApiClient: vi.fn(() => ({ apiFetch: mockApiFetch })),
}));

vi.stubGlobal(
  "useClerk",
  vi.fn(() => ({ signOut: mockSignOut })),
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

      await deleteAccount();

      expect(mockSignOut).toHaveBeenCalledWith({ redirectUrl: "/" });
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
  });
});
