/**
 * Thin wrapper around mapbox-gl that isolates the external library from the
 * rest of the app. All mapbox-gl calls go through this composable so tests can
 * mock it without needing a real map or a Mapbox token.
 *
 * Degrades gracefully: when the token is absent the composable is a no-op —
 * no map is mounted, no errors are thrown, and the CSS placeholder remains.
 *
 * Note: this composable holds module-level state (markerRegistry, dropPin*)
 * because there is only ever one active map at a time. Call destroyMap before
 * unmounting the page to fully clean up.
 */
import type mapboxgl from "mapbox-gl";
import type { Place } from "~/stores/places";
import { resolveMapboxStyleUrl } from "./useMapboxStyles";

// Named constant for the default map view
const DEFAULT_CENTER: [number, number] = [0, 20];
const DEFAULT_ZOOM = 2;

export type MapInstance = mapboxgl.Map;

export interface DropPinResult {
  latitude: number;
  longitude: number;
}

type MapboxGlModule = typeof mapboxgl;
type MapboxMarker = mapboxgl.Marker;
type MapMouseEventHandler = (event: mapboxgl.MapMouseEvent) => void;

// Module-level singleton state. Owned by one map page at a time;
// destroyMap clears everything on unmount.
const markerRegistry = new Map<string, MapboxMarker>();
let dropPinMarker: MapboxMarker | null = null;
let dropPinHandler: MapMouseEventHandler | null = null;
let dropPinMap: MapInstance | null = null;

export function useMapbox() {
  const config = useRuntimeConfig();
  const token = config.public.mapboxToken as string | undefined;

  function hasToken(): boolean {
    return Boolean(token);
  }

  async function loadMapboxGl(): Promise<MapboxGlModule | null> {
    if (!hasToken()) {
      return null;
    }
    const mapboxModule = await import("mapbox-gl");
    return (mapboxModule.default ?? mapboxModule) as unknown as MapboxGlModule;
  }

  async function initMap(
    container: HTMLElement,
    styleKey: string,
    onMapError?: (error: Error) => void,
  ): Promise<MapInstance | null> {
    const mapboxGl = await loadMapboxGl();

    if (!mapboxGl) {
      return null;
    }

    mapboxGl.accessToken = token as string;

    let mapInstance: mapboxgl.Map;

    try {
      mapInstance = new mapboxGl.Map({
        container,
        style: resolveMapboxStyleUrl(styleKey),
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });
    } catch (initError) {
      const error =
        initError instanceof Error
          ? initError
          : new Error("Mapbox map failed to initialize");
      console.error("Mapbox map failed to initialize", initError);
      onMapError?.(error);
      return null;
    }

    mapInstance.on("error", (event) => {
      if (onMapError) {
        onMapError(event.error ?? new Error("Mapbox map error"));
      }
    });

    return mapInstance;
  }

  function setStyle(map: MapInstance, styleKey: string): void {
    map.setStyle(resolveMapboxStyleUrl(styleKey));
  }

  function zoomIn(map: MapInstance): void {
    map.zoomIn();
  }

  function zoomOut(map: MapInstance): void {
    map.zoomOut();
  }

  function addMarker(
    mapboxGl: MapboxGlModule,
    map: MapInstance,
    place: Place,
    onClick: (placeId: string) => void,
  ): void {
    if (place.latitude === null || place.longitude === null) {
      return;
    }

    const existing = markerRegistry.get(place.id);
    if (existing) {
      // Reposition in place rather than recreate — avoids DOM churn and flicker
      existing.setLngLat([place.longitude, place.latitude]);
      return;
    }

    const markerElement = buildMarkerElement(place.id);
    markerElement.addEventListener("click", () => onClick(place.id));

    const marker = new mapboxGl.Marker({ element: markerElement })
      .setLngLat([place.longitude, place.latitude])
      .addTo(map);

    markerRegistry.set(place.id, marker);
  }

  function buildMarkerElement(placeId: string): HTMLElement {
    const button = document.createElement("button");
    button.className = "pin-abs sm";
    button.setAttribute("aria-label", `Map marker for place ${placeId}`);
    button.dataset.markerId = placeId;

    const ring = document.createElement("span");
    ring.className = "pin-ring";

    const icon = document.createElement("span");
    icon.className = "pin";
    icon.innerHTML = `<svg class="ico" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
    </svg>`;

    button.appendChild(ring);
    button.appendChild(icon);

    return button;
  }

  function setMarkerActive(
    placeId: string | null,
    previousPlaceId: string | null,
  ): void {
    if (previousPlaceId) {
      const previous = markerRegistry.get(previousPlaceId);
      previous?.getElement().classList.remove("is-active");
    }

    if (placeId) {
      const current = markerRegistry.get(placeId);
      current?.getElement().classList.add("is-active");
    }
  }

  function removeAllMarkers(): void {
    for (const marker of markerRegistry.values()) {
      marker.remove();
    }
    markerRegistry.clear();
  }

  async function syncMarkers(
    map: MapInstance,
    places: Place[],
    activePlaceId: string | null,
    onClick: (placeId: string) => void,
  ): Promise<void> {
    const mapboxGl = await loadMapboxGl();

    if (!mapboxGl) {
      return;
    }

    const placesWithCoords = places.filter(
      (place) => place.latitude !== null && place.longitude !== null,
    );

    const incomingIds = new Set(placesWithCoords.map((place) => place.id));

    for (const [existingId, marker] of markerRegistry.entries()) {
      if (incomingIds.has(existingId)) {
        continue;
      }
      marker.remove();
      markerRegistry.delete(existingId);
    }

    for (const place of placesWithCoords) {
      addMarker(mapboxGl, map, place, onClick);
    }

    setMarkerActive(activePlaceId, null);
  }

  async function startDropPin(
    map: MapInstance,
    onCoords: (result: DropPinResult) => void,
  ): Promise<void> {
    const mapboxGl = await loadMapboxGl();

    if (!mapboxGl) {
      return;
    }

    // Cancel any in-progress drop-pin before starting a new one
    cancelDropPin();

    function onMapClick(event: mapboxgl.MapMouseEvent): void {
      const { lng, lat } = event.lngLat;

      if (dropPinMarker) {
        dropPinMarker.remove();
      }

      dropPinMarker = new mapboxGl.Marker({ color: "#7c2bd9" })
        .setLngLat([lng, lat])
        .addTo(map);

      map.off("click", onMapClick);
      dropPinHandler = null;
      dropPinMap = null;
      onCoords({ latitude: lat, longitude: lng });
    }

    dropPinHandler = onMapClick;
    dropPinMap = map;
    map.on("click", onMapClick);
  }

  function cancelDropPin(): void {
    if (dropPinMap && dropPinHandler) {
      dropPinMap.off("click", dropPinHandler);
      dropPinHandler = null;
      dropPinMap = null;
    }

    if (dropPinMarker) {
      dropPinMarker.remove();
      dropPinMarker = null;
    }
  }

  function destroyMap(map: MapInstance): void {
    removeAllMarkers();
    cancelDropPin();
    map.remove();
  }

  return {
    hasToken,
    initMap,
    setStyle,
    zoomIn,
    zoomOut,
    syncMarkers,
    setMarkerActive,
    startDropPin,
    cancelDropPin,
    destroyMap,
  };
}
