import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApiFetch = vi.fn();

vi.stubGlobal("useState", (key: string, init: () => unknown) => {
  const { ref } = require("vue");
  return ref(init());
});

vi.mock("~/composables/useApiClient", () => ({
  useApiClient: vi.fn(() => ({ apiFetch: mockApiFetch })),
}));

const { usePreferences } = await import("../usePreferences");

describe("usePreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchPreferences", () => {
    it("sets preferences on success", async () => {
      const serverData = {
        distanceUnit: "km",
        defaultMapStyle: "dark",
        publicProfile: true,
        preciseLocation: false,
        showOnExplore: true,
        displayName: "Alice",
        handle: "alice",
        homeBase: "Paris",
        bio: "Wanderer.",
      };
      mockApiFetch.mockResolvedValue(serverData);

      const { fetchPreferences, preferences } = usePreferences();
      await fetchPreferences();

      expect(preferences.value).toEqual(serverData);
    });

    it("sets loadError when the API call fails with error.data.statusMessage", async () => {
      const serverError = Object.assign(new Error("[GET] 500"), {
        data: { statusMessage: "Internal Server Error from server" },
      });
      mockApiFetch.mockRejectedValue(serverError);

      const { fetchPreferences, loadError } = usePreferences();
      await fetchPreferences();

      expect(loadError.value).toBe("Internal Server Error from server");
    });

    it("never surfaces a bare top-level statusMessage (ofetch's raw HTTP reason phrase) — falls back to the generic message", async () => {
      // A top-level statusMessage with no data wrapper is exactly what
      // ofetch sets from response.statusText for infra-level failures (e.g.
      // a Netlify 502) our own server never touched — it must never be
      // trusted as intentional, user-facing copy.
      const fetchError = Object.assign(new Error("Bad Request"), {
        statusMessage: "Bad Request fallback",
      });
      mockApiFetch.mockRejectedValue(fetchError);

      const { fetchPreferences, loadError } = usePreferences();
      await fetchPreferences();

      expect(loadError.value).toBe("An unexpected error occurred");
    });

    it("never surfaces a raw Error message — falls back to the generic message", async () => {
      mockApiFetch.mockRejectedValue(new Error("network down"));

      const { fetchPreferences, loadError } = usePreferences();
      await fetchPreferences();

      expect(loadError.value).toBe("An unexpected error occurred");
    });
  });

  describe("savePreferences", () => {
    it("returns true and updates preferences on success", async () => {
      const updatedData = {
        distanceUnit: "km",
        defaultMapStyle: null,
        publicProfile: false,
        preciseLocation: false,
        showOnExplore: true,
        displayName: null,
        handle: null,
        homeBase: null,
        bio: null,
      };
      mockApiFetch.mockResolvedValue(updatedData);

      const { savePreferences, preferences } = usePreferences();
      const result = await savePreferences({ distanceUnit: "km" });

      expect(result).toBe(true);
      expect(preferences.value).toEqual(updatedData);
    });

    it("returns false and sets saveError on failure", async () => {
      const serverError = Object.assign(new Error("[PATCH] 409 Conflict"), {
        data: { statusMessage: "handle is already taken" },
      });
      mockApiFetch.mockRejectedValue(serverError);

      const { savePreferences, saveError } = usePreferences();
      const result = await savePreferences({ handle: "taken" });

      expect(result).toBe(false);
      expect(saveError.value).toBe("handle is already taken");
    });

    it("sends PATCH to /api/preferences with the supplied patch", async () => {
      mockApiFetch.mockResolvedValue({});

      const { savePreferences } = usePreferences();
      await savePreferences({ distanceUnit: "mi", publicProfile: true });

      expect(mockApiFetch).toHaveBeenCalledWith("/api/preferences", {
        method: "PATCH",
        body: { distanceUnit: "mi", publicProfile: true },
      });
    });
  });
});
