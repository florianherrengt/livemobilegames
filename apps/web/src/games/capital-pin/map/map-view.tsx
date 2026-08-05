import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { webConfig } from "../../../config.js";
import "../map.css";

export interface LngLat {
  lng: number;
  lat: number;
}

interface GameMapProps {
  /** Called when the user clicks the map to place/move a guess. */
  onMapClick?: (lngLat: LngLat) => void;
  /** Custom overlay markers as children (positioned via MapMarker). */
  children?: ReactNode;
  /** When true, clicks are ignored (e.g. after locking). */
  interactive?: boolean;
}

/**
 * A wrapper around a single MapLibre GL map instance. Text labels and POI
 * layers are hidden so the map cannot reveal the answer; zoom controls stay
 * available without rotation or pitch.
 */
export function GameMap({ onMapClick, children, interactive = true }: GameMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: webConfig.mapStyleUrl,
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

    const hideLabels = (): void => {
      const layers = map.getStyle()?.layers ?? [];
      for (const layer of layers) {
        const id = layer.id.toLowerCase();
        const isTextSymbol =
          layer.type === "symbol" && layer.layout !== undefined && "text-field" in layer.layout;
        const isLabelLayer =
          layer.type === "symbol" &&
          (id.includes("poi") ||
            id.includes("place") ||
            id.includes("road") ||
            id.includes("settlement") ||
            id.includes("airport"));
        if (isTextSymbol || isLabelLayer) {
          try {
            map.setLayoutProperty(layer.id, "visibility", "none");
          } catch {
            // Some layers do not support visibility changes; ignore.
          }
        }
      }
    };

    map.on("load", () => {
      hideLabels();
      setMapReady(true);
    });
    map.on("styledata", () => {
      if (map.isStyleLoaded()) {
        hideLabels();
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const handleClick = (event: maplibregl.MapMouseEvent & { lngLat: maplibregl.LngLat }) => {
      if (!interactive) {
        return;
      }
      onMapClick?.({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    };
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [onMapClick, interactive]);

  return (
    <div className="cp-map-container" ref={containerRef} role="application" aria-label="World map">
      {mapReady && mapRef.current && (
        <MapContextProvider map={mapRef.current}>{children}</MapContextProvider>
      )}
    </div>
  );
}

const MapContext = createContext<maplibregl.Map | null>(null);

function MapContextProvider({ map, children }: { map: maplibregl.Map; children: ReactNode }) {
  return <MapContext.Provider value={map}>{children}</MapContext.Provider>;
}

/** Hook used by marker children to access the underlying map instance. */
export function useMap(): maplibregl.Map | null {
  return useContext(MapContext);
}
