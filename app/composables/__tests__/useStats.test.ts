import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

const mockApiFetch = vi.fn();

vi.stubGlobal("useState", (_key: string, init: () => unknown) => {
  return ref(init());
});

vi.mock("~/composables/useApiClient", () => ({
  useApiClient: vi.fn(() => ({ apiFetch: mockApiFetch })),
}));

const { useStats } = await import("../useStats");

const SAMPLE_STATS = {
  placesCount: 117,
  countriesCount: 9,
  totalDistanceKm: 77600,
  totalDistanceMi: 48218,
  currentStreak: 14,
  placesThisWeek: 6,
  distanceKmThisWeek: 2254,
  distanceMiThisWeek: 1400,
  distanceUnit: "mi",
};

describe("useStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with zero-value defaults", () => {
    const { stats } = useStats();
    expect(stats.value.placesCount).toBe(0);
    expect(stats.value.countriesCount).toBe(0);
    expect(stats.value.currentStreak).toBe(0);
    expect(stats.value.totalDistanceMi).toBe(0);
    expect(stats.value.distanceUnit).toBe("mi");
  });

  describe("fetchStats", () => {
    it("sets stats on success", async () => {
      mockApiFetch.mockResolvedValue(SAMPLE_STATS);

      const { fetchStats, stats } = useStats();
      await fetchStats();

      expect(stats.value).toEqual(SAMPLE_STATS);
    });

    it("calls /api/stats endpoint", async () => {
      mockApiFetch.mockResolvedValue(SAMPLE_STATS);

      const { fetchStats } = useStats();
      await fetchStats();

      expect(mockApiFetch).toHaveBeenCalledWith("/api/stats");
    });

    it("sets loadError when the API call fails with error.data.statusMessage", async () => {
      const serverError = Object.assign(new Error("[GET] 500"), {
        data: { statusMessage: "Internal Server Error" },
      });
      mockApiFetch.mockRejectedValue(serverError);

      const { fetchStats, loadError } = useStats();
      await fetchStats();

      expect(loadError.value).toBe("Internal Server Error");
    });

    it("resets stats to defaults when the API call fails", async () => {
      mockApiFetch.mockResolvedValueOnce(SAMPLE_STATS);
      const { fetchStats, stats } = useStats();
      await fetchStats();
      expect(stats.value.placesCount).toBe(117);

      mockApiFetch.mockRejectedValue(new Error("network down"));
      await fetchStats();

      expect(stats.value.placesCount).toBe(0);
      expect(stats.value.totalDistanceMi).toBe(0);
      expect(stats.value.currentStreak).toBe(0);
    });

    it("falls back to error.statusMessage when data is absent", async () => {
      const fetchError = Object.assign(new Error("Bad Request"), {
        statusMessage: "Bad Request fallback",
      });
      mockApiFetch.mockRejectedValue(fetchError);

      const { fetchStats, loadError } = useStats();
      await fetchStats();

      expect(loadError.value).toBe("Bad Request fallback");
    });

    it("never surfaces a raw Error message — falls back to the generic message", async () => {
      mockApiFetch.mockRejectedValue(new Error("network down"));

      const { fetchStats, loadError } = useStats();
      await fetchStats();

      expect(loadError.value).toBe("An unexpected error occurred");
    });

    it("falls back to generic message when error has no recognizable shape", async () => {
      mockApiFetch.mockRejectedValue("plain string error");

      const { fetchStats, loadError } = useStats();
      await fetchStats();

      expect(loadError.value).toBe("An unexpected error occurred");
    });

    it("exposes isLoading as readonly", () => {
      const { isLoading } = useStats();
      expect(typeof isLoading.value).toBe("boolean");
    });

    it("exposes loadError as readonly", () => {
      const { loadError } = useStats();
      expect(loadError.value).toBeNull();
    });
  });

  describe("derived distance helpers", () => {
    it("displayDistance returns totalDistanceMi when unit is mi", async () => {
      mockApiFetch.mockResolvedValue({ ...SAMPLE_STATS, distanceUnit: "mi" });
      const { fetchStats, displayDistance } = useStats();
      await fetchStats();
      expect(displayDistance.value).toBe(SAMPLE_STATS.totalDistanceMi);
    });

    it("displayDistance returns totalDistanceKm when unit is km", async () => {
      mockApiFetch.mockResolvedValue({ ...SAMPLE_STATS, distanceUnit: "km" });
      const { fetchStats, displayDistance } = useStats();
      await fetchStats();
      expect(displayDistance.value).toBe(SAMPLE_STATS.totalDistanceKm);
    });

    it("displayDistanceDelta returns distanceMiThisWeek when unit is mi", async () => {
      mockApiFetch.mockResolvedValue({ ...SAMPLE_STATS, distanceUnit: "mi" });
      const { fetchStats, displayDistanceDelta } = useStats();
      await fetchStats();
      expect(displayDistanceDelta.value).toBe(SAMPLE_STATS.distanceMiThisWeek);
    });

    it("displayDistanceDelta returns distanceKmThisWeek when unit is km", async () => {
      mockApiFetch.mockResolvedValue({ ...SAMPLE_STATS, distanceUnit: "km" });
      const { fetchStats, displayDistanceDelta } = useStats();
      await fetchStats();
      expect(displayDistanceDelta.value).toBe(SAMPLE_STATS.distanceKmThisWeek);
    });

    it("displayDistanceLabel returns 'Miles logged' when unit is mi", async () => {
      mockApiFetch.mockResolvedValue({ ...SAMPLE_STATS, distanceUnit: "mi" });
      const { fetchStats, displayDistanceLabel } = useStats();
      await fetchStats();
      expect(displayDistanceLabel.value).toBe("Miles logged");
    });

    it("displayDistanceLabel returns 'Km logged' when unit is km", async () => {
      mockApiFetch.mockResolvedValue({ ...SAMPLE_STATS, distanceUnit: "km" });
      const { fetchStats, displayDistanceLabel } = useStats();
      await fetchStats();
      expect(displayDistanceLabel.value).toBe("Km logged");
    });
  });
});
