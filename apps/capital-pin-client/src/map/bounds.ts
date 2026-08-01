import type { LngLatBoundsLike } from "maplibre-gl";

export interface Point {
  longitude: number;
  latitude: number;
}

export interface FitBoundsResult {
  kind: "fitBounds";
  bounds: LngLatBoundsLike;
  padding: number;
  maxZoom: number;
}

export interface FitWorldResult {
  kind: "fitWorld";
  center: [number, number];
  zoom: number;
}

export type CameraResult = FitBoundsResult | FitWorldResult;

/**
 * Compute the camera for the results view.
 *
 * - When the longitude span is <= 180 degrees, fit the bounds with padding.
 * - When the longitude span is > 180 degrees, show the whole world instead,
 *   to avoid a misleading antimeridian wrap.
 *
 * `isMobile` controls padding (smaller on mobile).
 */
export function computeResultsCamera(
  points: Point[],
  isMobile: boolean,
  maxResultZoom = 6,
): CameraResult {
  if (points.length === 0) {
    return { kind: "fitWorld", center: [0, 20], zoom: 1 };
  }

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const p of points) {
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
  }

  const lngSpan = maxLng - minLng;
  if (lngSpan > 180) {
    return { kind: "fitWorld", center: [0, 20], zoom: 1 };
  }

  const padding = isMobile ? 40 : 120;
  const bounds: LngLatBoundsLike = [minLng, minLat, maxLng, maxLat];
  return { kind: "fitBounds", bounds, padding, maxZoom: maxResultZoom };
}
