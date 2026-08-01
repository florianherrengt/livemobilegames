import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { getMapStyleUrl } from "../map/mapStyle.js";

export interface LngLat {
  lng: number;
  lat: number;
}

interface GameMapProps {
  /** Called when the user clicks the map to place/move a guess (guess mode only). */
  onMapClick?: (lngLat: LngLat) => void;
  /** Render custom overlay markers as children (positioned via Marker components). */
  children?: ReactNode;
  /** When true, clicks are ignored (e.g. after locking). */
  interactive?: boolean;
}

/**
 * A wrapper around a single MapLibre GL map instance.
 *
 * Hides all text labels so the map cannot reveal the answer, shows zoom
 * controls (no compass), and keeps attribution visible.
 */
export function GameMap({ onMapClick, children, interactive = true }: GameMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyleUrl(),
      center: [0, 20],
      zoom: 1.4,
      minZoom: 1,
      maxZoom: 7,
      renderWorldCopies: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      hideLabels(map);
      setMapReady(true);
    });

    // Even if 'load' already fired, make sure we can render markers.
    map.on("styledata", () => {
      if (map.isStyleLoaded()) {
        hideLabels(map);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Wire up click handling.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handleClick = (e: maplibregl.MapMouseEvent & { lngLat: maplibregl.LngLat }) => {
      if (!interactive) return;
      onMapClick?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    };
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [onMapClick, interactive]);

  return (
    <div className="map-container" ref={containerRef} role="application" aria-label="World map">
      {mapReady && mapRef.current && (
        <MapContextProvider map={mapRef.current}>{children}</MapContextProvider>
      )}
    </div>
  );
}

/**
 * Hide every symbol layer that has a text field, plus POI/road labels.
 * Keeps land, water, country boundaries, coastlines and geographic shapes.
 */
function hideLabels(map: maplibregl.Map): void {
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  for (const layer of layers) {
    if (layer.type === "symbol" && layer.layout && "text-field" in layer.layout) {
      try {
        map.setLayoutProperty(layer.id, "visibility", "none");
      } catch {
        // Some layers may not support visibility changes; ignore.
      }
    }
  }
  // Hide label-related source layers explicitly if present.
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    if (
      id.includes("poi") ||
      id.includes("place") ||
      id.includes("road") ||
      id.includes("settlement") ||
      id.includes("airport")
    ) {
      if (layer.type === "symbol") {
        try {
          map.setLayoutProperty(layer.id, "visibility", "none");
        } catch {
          // ignore
        }
      }
    }
  }
}

const MapContext = createContext<maplibregl.Map | null>(null);

function MapContextProvider({ map, children }: { map: maplibregl.Map; children: ReactNode }) {
  return <MapContext.Provider value={map}>{children}</MapContext.Provider>;
}

/** Hook used by marker children to access the underlying map instance. */
export function useMap(): maplibregl.Map | null {
  return useContext(MapContext);
}
