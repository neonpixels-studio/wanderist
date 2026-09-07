import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub useRuntimeConfig before importing the composable
vi.stubGlobal("useRuntimeConfig", () => ({
  public: { mapboxToken: "" },
}));

// Mock mapbox-gl so no real canvas/WebGL is needed
const mockMapOn = vi.fn();
const mockMapOff = vi.fn();
const mockMapSetStyle = vi.fn();
const mockMapZoomIn = vi.fn();
const mockMapZoomOut = vi.fn();
const mockMapRemove = vi.fn();
const mockMapFlyTo = vi.fn();

class MockMap {
  on = mockMapOn;
  off = mockMapOff;
  setStyle = mockMapSetStyle;
  zoomIn = mockMapZoomIn;
  zoomOut = mockMapZoomOut;
  remove = mockMapRemove;
  flyTo = mockMapFlyTo;
}

const mockMarkerSetLngLat = vi.fn().mockReturnThis();
const mockMarkerAddTo = vi.fn().mockReturnThis();
const mockMarkerRemove = vi.fn();
const mockMarkerGetElement = vi.fn();

// Track all created marker instances for assertions
const createdMarkers: MockMarker[] = [];

class MockMarker {
  element: HTMLElement;

  constructor(options?: { element?: HTMLElement; color?: string }) {
    this.element = options?.element ?? document.createElement("button");
    createdMarkers.push(this);
  }

  setLngLat = mockMarkerSetLngLat;
  addTo = mockMarkerAddTo;
  remove = mockMarkerRemove;
  getElement(): HTMLElement {
    mockMarkerGetElement(this.element);
    return this.element;
  }
}

const mockMapboxGl = {
  Map: MockMap,
  Marker: MockMarker,
  accessToken: "",
};

vi.mock("mapbox-gl", () => ({ default: mockMapboxGl }));

// Import after mocks are set up
const { useMapbox } = await import("../useMapbox");

function makeMap(): mapboxgl.Map {
  return new MockMap() as unknown as mapboxgl.Map;
}

describe("useMapbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("useRuntimeConfig", () => ({
      public: { mapboxToken: "" },
    }));
    mockMarkerSetLngLat.mockReturnThis();
    mockMarkerAddTo.mockReturnThis();

    // Reset the created markers array and singleton drop-pin state between tests
    createdMarkers.length = 0;
    const { cancelDropPin } = useMapbox();
    cancelDropPin();

    // Error-path tests exercise the catch block, which logs via console.error.
    // Silence it so the expected log doesn't pollute test output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("hasToken", () => {
    it("returns false when token is empty string", () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "" },
      }));
      const { hasToken } = useMapbox();
      expect(hasToken()).toBe(false);
    });

    it("returns true when token is present", () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));
      const { hasToken } = useMapbox();
      expect(hasToken()).toBe(true);
    });
  });

  describe("initMap", () => {
    it("returns null when token is absent", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "" },
      }));
      const { initMap } = useMapbox();
      const container = document.createElement("div");
      const result = await initMap(container, "outdoors");
      expect(result).toBeNull();
    });

    it("creates a Map instance when token is present", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));
      const { initMap } = useMapbox();
      const container = document.createElement("div");
      const result = await initMap(container, "outdoors");
      expect(result).toBeInstanceOf(MockMap);
    });

    it("returns null and does not throw when Map constructor throws", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));
      // Use a function expression (not an arrow) so vitest recognizes this as a
      // constructor mock — Map is invoked with `new`.
      vi.spyOn(mockMapboxGl, "Map").mockImplementationOnce(function () {
        throw new Error("WebGL not supported");
      });
      const { initMap } = useMapbox();
      const container = document.createElement("div");
      const result = await initMap(container, "outdoors");
      expect(result).toBeNull();
    });

    it("invokes onMapError callback when map emits an error", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));
      const { initMap } = useMapbox();
      const container = document.createElement("div");
      const onMapError = vi.fn();

      await initMap(container, "outdoors", onMapError);

      // Find the error event listener registered via mockMapOn
      const errorCall = mockMapOn.mock.calls.find(
        (call) => call[0] === "error",
      );
      expect(errorCall).toBeDefined();

      const errorHandler = errorCall![1];
      const fakeError = new Error("tile fetch failed");
      errorHandler({ error: fakeError });

      expect(onMapError).toHaveBeenCalledWith(fakeError);
    });
  });

  describe("setStyle", () => {
    it("calls map.setStyle with the resolved Mapbox style URL", () => {
      const { setStyle } = useMapbox();
      setStyle(makeMap(), "streets");
      expect(mockMapSetStyle).toHaveBeenCalledWith(
        "mapbox://styles/mapbox/streets-v12",
      );
    });
  });

  describe("zoomIn", () => {
    it("calls map.zoomIn", () => {
      const { zoomIn } = useMapbox();
      zoomIn(makeMap());
      expect(mockMapZoomIn).toHaveBeenCalled();
    });
  });

  describe("zoomOut", () => {
    it("calls map.zoomOut", () => {
      const { zoomOut } = useMapbox();
      zoomOut(makeMap());
      expect(mockMapZoomOut).toHaveBeenCalled();
    });
  });

  describe("flyTo", () => {
    it("calls map.flyTo with the given coordinates and a focus zoom level", () => {
      const { flyTo } = useMapbox();
      flyTo(makeMap(), 139.6503, 35.6762);
      expect(mockMapFlyTo).toHaveBeenCalledWith({
        center: [139.6503, 35.6762],
        zoom: 9,
      });
    });
  });

  describe("cancelDropPin", () => {
    it("does not throw when no drop-pin is active", () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "" },
      }));
      const { cancelDropPin } = useMapbox();
      expect(() => cancelDropPin()).not.toThrow();
    });

    it("detaches the click handler from the map when called before the map is clicked", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));

      const { startDropPin, cancelDropPin } = useMapbox();
      const fakeMap = makeMap();
      const onCoords = vi.fn();

      await startDropPin(fakeMap, onCoords);

      // Verify the click handler was attached
      expect(mockMapOn).toHaveBeenCalledWith("click", expect.any(Function));
      const attachedHandler = mockMapOn.mock.calls.find(
        (call) => call[0] === "click",
      )![1];

      // Cancel before the map is clicked
      cancelDropPin();

      // Verify the same handler was detached
      expect(mockMapOff).toHaveBeenCalledWith("click", attachedHandler);
      expect(onCoords).not.toHaveBeenCalled();
    });
  });

  describe("destroyMap", () => {
    it("calls map.remove", () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "" },
      }));
      const { destroyMap } = useMapbox();
      destroyMap(makeMap());
      expect(mockMapRemove).toHaveBeenCalled();
    });
  });

  describe("setMarkerActive", () => {
    it("does not throw when both ids are null", () => {
      const { setMarkerActive } = useMapbox();
      expect(() => setMarkerActive(null, null)).not.toThrow();
    });

    it("adds is-active class to the active marker element", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));

      const { syncMarkers, setMarkerActive, destroyMap } = useMapbox();
      const fakeMap = makeMap();

      const places = [
        {
          id: "p-1",
          userId: "u-1",
          name: "Tokyo",
          subtitle: null,
          country: null,
          category: null,
          latitude: 35.6762,
          longitude: 139.6503,
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      await syncMarkers(fakeMap, places, null, vi.fn());

      // The marker created for p-1 is the first in createdMarkers
      const markerElement = createdMarkers[0].element;

      setMarkerActive("p-1", null);

      expect(markerElement.classList.contains("is-active")).toBe(true);

      destroyMap(fakeMap);
    });

    it("removes is-active class from the previous marker element", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));

      const { syncMarkers, setMarkerActive, destroyMap } = useMapbox();
      const fakeMap = makeMap();

      const places = [
        {
          id: "p-1",
          userId: "u-1",
          name: "Tokyo",
          subtitle: null,
          country: null,
          category: null,
          latitude: 35.6762,
          longitude: 139.6503,
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      await syncMarkers(fakeMap, places, null, vi.fn());

      const markerElement = createdMarkers[0].element;
      markerElement.classList.add("is-active");

      setMarkerActive(null, "p-1");

      expect(markerElement.classList.contains("is-active")).toBe(false);

      destroyMap(fakeMap);
    });
  });

  describe("syncMarkers", () => {
    it("is a no-op when token is absent", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "" },
      }));
      const { syncMarkers } = useMapbox();
      const fakeMap = makeMap();
      const places = [
        {
          id: "p-1",
          userId: "u-1",
          name: "Tokyo",
          subtitle: null,
          country: null,
          category: null,
          latitude: 35.6762,
          longitude: 139.6503,
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      await expect(
        syncMarkers(fakeMap, places, null, vi.fn()),
      ).resolves.toBeUndefined();

      expect(mockMarkerSetLngLat).not.toHaveBeenCalled();
    });

    it("adds markers for places with coordinates when token is present", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));

      const { syncMarkers, destroyMap } = useMapbox();
      const fakeMap = makeMap();
      const places = [
        {
          id: "p-1",
          userId: "u-1",
          name: "Tokyo",
          subtitle: null,
          country: null,
          category: null,
          latitude: 35.6762,
          longitude: 139.6503,
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
        {
          id: "p-2",
          userId: "u-1",
          name: "No coords",
          subtitle: null,
          country: null,
          category: null,
          latitude: null,
          longitude: null,
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      await syncMarkers(fakeMap, places, null, vi.fn());

      expect(mockMarkerSetLngLat).toHaveBeenCalledTimes(1);
      expect(mockMarkerSetLngLat).toHaveBeenCalledWith([139.6503, 35.6762]);
      expect(mockMarkerAddTo).toHaveBeenCalledWith(fakeMap);

      destroyMap(fakeMap);
    });
  });

  describe("startDropPin", () => {
    it("is a no-op when token is absent", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "" },
      }));

      const { startDropPin } = useMapbox();
      const fakeMap = makeMap();
      const onCoords = vi.fn();

      await startDropPin(fakeMap, onCoords);

      expect(mockMapOn).not.toHaveBeenCalled();
    });

    it("registers a click handler on the map when token is present", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));

      const { startDropPin, cancelDropPin } = useMapbox();
      const fakeMap = makeMap();
      const onCoords = vi.fn();

      await startDropPin(fakeMap, onCoords);

      expect(mockMapOn).toHaveBeenCalledWith("click", expect.any(Function));

      cancelDropPin();
    });

    it("invokes onCoords with lat/lng when the map is clicked", async () => {
      vi.stubGlobal("useRuntimeConfig", () => ({
        public: { mapboxToken: "pk.test.token" },
      }));

      const { startDropPin } = useMapbox();
      const fakeMap = makeMap();
      const onCoords = vi.fn();

      await startDropPin(fakeMap, onCoords);

      const clickCall = mockMapOn.mock.calls.find(
        (call) => call[0] === "click",
      );
      expect(clickCall).toBeDefined();
      const clickHandler = clickCall![1];

      // Simulate a map click event
      clickHandler({ lngLat: { lng: 2.3522, lat: 48.8566 } });

      expect(onCoords).toHaveBeenCalledWith({
        latitude: 48.8566,
        longitude: 2.3522,
      });

      // After click, handler should be detached
      expect(mockMapOff).toHaveBeenCalledWith("click", clickHandler);
    });
  });
});
