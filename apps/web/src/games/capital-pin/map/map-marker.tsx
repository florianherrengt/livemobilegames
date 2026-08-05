import * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "./map-view.js";
import { readableTextOn } from "./markers.js";

interface MapMarkerProps {
  longitude: number;
  latitude: number;
  colour: string;
  /** Optional label rendered inside the pin (e.g. a player initial). */
  label?: string;
}

/**
 * A MapLibre marker whose lifecycle is owned by React: it is added to the map
 * once the map is available, re-created when its position or appearance
 * changes, and removed on unmount. The component itself renders nothing.
 */
export function MapMarker({ longitude, latitude, colour, label }: MapMarkerProps) {
  const map = useMap();

  useEffect(() => {
    if (!map) {
      return;
    }

    const element = document.createElement("div");
    element.className = "cp-pin-marker";
    element.style.background = colour;
    element.dataset.lng = String(longitude);
    element.dataset.lat = String(latitude);
    if (label !== undefined) {
      element.style.color = readableTextOn(colour);
      element.textContent = label;
    }

    const marker = new maplibregl.Marker({ element }).setLngLat([longitude, latitude]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, longitude, latitude, colour, label]);

  return null;
}
