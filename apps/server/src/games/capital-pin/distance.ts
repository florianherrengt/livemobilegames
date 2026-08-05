import { CAPITAL_PIN_CONSTANTS } from "./constants.js";

export { formatDistanceKm } from "@phone-party/protocol";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Validate raw coordinate-like input before any distance math. Throws on
 * invalid input so callers can map it to a stable error.
 */
export function assertValidCoordinates(value: unknown): asserts value is Coordinates {
  if (typeof value !== "object" || value === null) {
    throw new Error("Coordinates must be an object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.latitude !== "number" || !Number.isFinite(v.latitude)) {
    throw new Error("latitude must be a finite number");
  }
  if (typeof v.longitude !== "number" || !Number.isFinite(v.longitude)) {
    throw new Error("longitude must be a finite number");
  }
  if (v.latitude < -90 || v.latitude > 90) {
    throw new Error("latitude out of range");
  }
  if (v.longitude < -180 || v.longitude > 180) {
    throw new Error("longitude out of range");
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two points using the Haversine formula and the
 * mean Earth radius. Result is in kilometres. Works across the antimeridian
 * and across hemispheres.
 */
export function haversineDistanceKm(from: Coordinates, to: Coordinates): number {
  const fromLatRad = toRadians(from.latitude);
  const toLatRad = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const sinDeltaLat = Math.sin(deltaLat / 2);
  const sinDeltaLon = Math.sin(deltaLon / 2);

  const a =
    sinDeltaLat * sinDeltaLat +
    Math.cos(fromLatRad) * Math.cos(toLatRad) * sinDeltaLon * sinDeltaLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return CAPITAL_PIN_CONSTANTS.EARTH_RADIUS_KM * c;
}
