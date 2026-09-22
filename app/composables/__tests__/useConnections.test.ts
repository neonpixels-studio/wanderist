/**
 * Unit tests for the useConnections composable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

// ---------------------------------------------------------------------------
// Mock auto-imports and composables
// ---------------------------------------------------------------------------

const mockApiFetch = vi.fn();

vi.mock("~/composables/useApiClient", () => ({
  useApiClient: () => ({ apiFetch: mockApiFetch }),
}));

vi.stubGlobal("useState", <T>(key: string, init: () => T) => {
  const state = ref(init());
  return state;
});

vi.stubGlobal("readonly", (value: unknown) => value);

// ---------------------------------------------------------------------------
// Import composable after mocks
// ---------------------------------------------------------------------------

const { useConnections, describeInstagramImportResult } =
  await import("../useConnections");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchConnections", () => {
    it("populates google connection info from the API", async () => {
      // fetchConnections fires two parallel calls: instagram then google.
      mockApiFetch
        .mockResolvedValueOnce({ connected: false })
        .mockResolvedValueOnce({
          connected: true,
          emailAddress: "user@gmail.com",
          identificationId: "idn_abc",
        });

      const { fetchConnections, connections } = useConnections();
      await fetchConnections();

      expect(
        (
          connections as {
            value: {
              google: { connected: boolean; emailAddress: string | null };
            };
          }
        ).value.google.connected,
      ).toBe(true);
      expect(
        (
          connections as {
            value: {
              google: { connected: boolean; emailAddress: string | null };
            };
          }
        ).value.google.emailAddress,
      ).toBe("user@gmail.com");
    });

    it("sets loadError from a server-intended data.statusMessage when the API call fails", async () => {
      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Network error"), {
          data: { statusMessage: "Network error" },
        }),
      );

      const { fetchConnections, loadError } = useConnections();
      await fetchConnections();

      expect((loadError as { value: string | null }).value).toBe(
        "Network error",
      );
    });

    it("never surfaces a raw Error message — falls back to the generic message", async () => {
      // Regression guard for the shared extractErrorMessage bug: this
      // composable used to carry its own local copy of the function (with
      // the same raw-message leak) instead of importing the shared,
      // fixed utility.
      mockApiFetch.mockRejectedValueOnce(new Error("network down"));

      const { fetchConnections, loadError } = useConnections();
      await fetchConnections();

      expect((loadError as { value: string | null }).value).toBe(
        "An unexpected error occurred",
      );
    });
  });

  describe("disconnectInstagram", () => {
    it("calls DELETE /api/connections/instagram and updates connected state", async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: true });

      const { disconnectInstagram, connections } = useConnections();
      const result = await disconnectInstagram();

      expect(mockApiFetch).toHaveBeenCalledWith("/api/connections/instagram", {
        method: "DELETE",
      });
      expect(result).toBe(true);
      expect(
        (connections as { value: { instagram: { connected: boolean } } }).value
          .instagram.connected,
      ).toBe(false);
    });

    it("sets actionError and returns false on failure", async () => {
      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Not connected"), {
          data: { statusMessage: "Not connected" },
        }),
      );

      const { disconnectInstagram, actionError } = useConnections();
      const result = await disconnectInstagram();

      expect(result).toBe(false);
      expect((actionError as { value: string | null }).value).toBe(
        "Not connected",
      );
    });
  });

  describe("disconnectGoogle", () => {
    it("calls DELETE /api/connections/google with the identificationId", async () => {
      // fetchConnections fires two parallel calls (instagram, google) then
      // disconnectGoogle fires a third.
      mockApiFetch
        .mockResolvedValueOnce({ connected: false })
        .mockResolvedValueOnce({
          connected: true,
          emailAddress: "u@g.com",
          identificationId: "idn_abc",
        })
        .mockResolvedValueOnce({ ok: true });

      const { fetchConnections, disconnectGoogle } = useConnections();
      await fetchConnections();
      const result = await disconnectGoogle();

      expect(result).toBe(true);
      expect(mockApiFetch).toHaveBeenCalledWith("/api/connections/google", {
        method: "DELETE",
        body: { identificationId: "idn_abc" },
      });
    });

    it("sets actionError and returns false when Google is not connected", async () => {
      const { disconnectGoogle, actionError } = useConnections();
      const result = await disconnectGoogle();

      expect(result).toBe(false);
      expect((actionError as { value: string | null }).value).toBeTruthy();
    });
  });

  describe("importInstagramPhotos", () => {
    it("calls POST /api/connections/instagram/import and sets importResult", async () => {
      mockApiFetch.mockResolvedValueOnce({
        imported: 5,
        skipped: 1,
        errors: [],
        hasMore: false,
        remaining: 0,
      });

      const { importInstagramPhotos, importResult } = useConnections();
      const result = await importInstagramPhotos();

      expect(result).toBe(true);
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/connections/instagram/import",
        { method: "POST" },
      );
      expect(
        (importResult as { value: { imported: number } | null }).value
          ?.imported,
      ).toBe(5);
    });

    it("sets actionError and returns false on failure", async () => {
      mockApiFetch.mockRejectedValueOnce(
        Object.assign(new Error("Not connected"), {
          statusMessage: "Instagram account not connected",
        }),
      );

      const { importInstagramPhotos, actionError } = useConnections();
      const result = await importInstagramPhotos();

      expect(result).toBe(false);
      expect((actionError as { value: string | null }).value).toBeTruthy();
    });
  });

  describe("fetchConnections", () => {
    it("fetches both Instagram and Google connections in parallel", async () => {
      mockApiFetch
        .mockResolvedValueOnce({ connected: true })
        .mockResolvedValueOnce({
          connected: true,
          emailAddress: "u@g.com",
          identificationId: "idn_abc",
        });

      const { fetchConnections, connections } = useConnections();
      await fetchConnections();

      expect(mockApiFetch).toHaveBeenCalledWith("/api/connections/instagram");
      expect(mockApiFetch).toHaveBeenCalledWith("/api/connections/google");
      expect(
        (connections as { value: { instagram: { connected: boolean } } }).value
          .instagram.connected,
      ).toBe(true);
    });
  });
});

describe("describeInstagramImportResult", () => {
  it("reports a clean full import as a success with no resume hint", () => {
    const result = describeInstagramImportResult({
      imported: 3,
      skipped: 0,
      errors: [],
      hasMore: false,
      remaining: 0,
    });

    expect(result).toEqual({
      message: "Imported 3 photos.",
      intent: "success",
    });
  });

  it("uses the singular noun for a single imported photo", () => {
    const result = describeInstagramImportResult({
      imported: 1,
      skipped: 0,
      errors: [],
      hasMore: false,
      remaining: 0,
    });

    expect(result.message).toBe("Imported 1 photo.");
  });

  it("appends the remaining count as a resume hint when more remain", () => {
    const result = describeInstagramImportResult({
      imported: 8,
      skipped: 0,
      errors: [],
      hasMore: true,
      remaining: 42,
    });

    expect(result).toEqual({
      message:
        "Imported 8 photos. 42 more remain, run import again to continue.",
      intent: "success",
    });
  });

  it("warns (not errors) when some imported and some failed", () => {
    const result = describeInstagramImportResult({
      imported: 7,
      skipped: 0,
      errors: ["Item a: CDN 404", "Item b: timeout"],
      hasMore: false,
      remaining: 0,
    });

    expect(result).toEqual({
      message: "Imported 7 photos, 2 failed.",
      intent: "warning",
    });
  });

  it("errors when nothing imported and every item failed", () => {
    const result = describeInstagramImportResult({
      imported: 0,
      skipped: 0,
      errors: ["Item a: CDN 404"],
      hasMore: false,
      remaining: 0,
    });

    expect(result).toEqual({
      message: "Imported 0 photos, 1 failed.",
      intent: "error",
    });
  });

  it("appends the resume hint on a partial-failure run that still has work queued", () => {
    const result = describeInstagramImportResult({
      imported: 7,
      skipped: 0,
      errors: ["Item a: CDN 404", "Item b: timeout"],
      hasMore: true,
      remaining: 3,
    });

    expect(result).toEqual({
      message:
        "Imported 7 photos, 2 failed. 3 more remain, run import again to continue.",
      intent: "warning",
    });
  });

  it("is informational (not success) when the run imported nothing but has work queued", () => {
    const result = describeInstagramImportResult({
      imported: 0,
      skipped: 0,
      errors: [],
      hasMore: true,
      remaining: 2,
    });

    expect(result).toEqual({
      message:
        "Imported 0 photos. 2 more remain, run import again to continue.",
      intent: "info",
    });
  });

  it("uses the singular verb in the resume hint when exactly one remains", () => {
    const result = describeInstagramImportResult({
      imported: 4,
      skipped: 0,
      errors: [],
      hasMore: true,
      remaining: 1,
    });

    expect(result).toEqual({
      message:
        "Imported 4 photos. 1 more remains, run import again to continue.",
      intent: "success",
    });
  });

  it("warns (not errors) when nothing imported but a resume is queued", () => {
    const result = describeInstagramImportResult({
      imported: 0,
      skipped: 0,
      errors: ["Item a: CDN 404"],
      hasMore: true,
      remaining: 3,
    });

    expect(result).toEqual({
      message:
        "Imported 0 photos, 1 failed. 3 more remain, run import again to continue.",
      intent: "warning",
    });
  });

  it("names never-attempted items when the whole batch failed and no resume is queued", () => {
    const result = describeInstagramImportResult({
      imported: 0,
      skipped: 0,
      errors: ["Item a: CDN 404", "Item b: CDN 404"],
      hasMore: false,
      remaining: 5,
    });

    // 2 failed this run, 3 were never reached; surface both, not just the fails.
    expect(result).toEqual({
      message: "Imported 0 photos, 2 failed. 3 still pending.",
      intent: "error",
    });
  });
});
