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
 * Compute the camera for the results view. When the longitude span is at most
 * 180 degrees, fit the bounds with padding; a larger span shows the whole
 * world instead, avoiding a misleading antimeridian wrap.
 */
export function computeResultsCamera(
  points: Point[],
  isMobile: boolean,
  maxResultZoom = 6,
): CameraResult {
  if (points.length === 0) {
    return { kind: "fitWorld", center: [0, 20], zoom: 1 };
  }

  const bounds = points.reduce(
    (acc, point) => ({
      minLng: Math.min(acc.minLng, point.longitude),
      maxLng: Math.max(acc.maxLng, point.longitude),
      minLat: Math.min(acc.minLat, point.latitude),
      maxLat: Math.max(acc.maxLat, point.latitude),
    }),
    {
      minLng: Number.POSITIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
    },
  );

  const lngSpan = bounds.maxLng - bounds.minLng;
  if (lngSpan > 180) {
    return { kind: "fitWorld", center: [0, 20], zoom: 1 };
  }

  const padding = isMobile ? 40 : 120;
  const lngLatBounds: LngLatBoundsLike = [
    bounds.minLng,
    bounds.minLat,
    bounds.maxLng,
    bounds.maxLat,
  ];
  return { kind: "fitBounds", bounds: lngLatBounds, padding, maxZoom: maxResultZoom };
}
