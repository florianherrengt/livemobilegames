import { describe, expect, it } from "vitest";

import {
  assertValidCoordinates,
  formatDistanceKm,
  haversineDistanceKm,
} from "../../../src/games/capital-pin/distance.js";

describe("haversine distance", () => {
  it("returns zero for identical coordinates", () => {
    expect(
      haversineDistanceKm(
        { latitude: 51.5, longitude: -0.12 },
        { latitude: 51.5, longitude: -0.12 },
      ),
    ).toBe(0);
  });

  it("matches a known London-Paris distance", () => {
    const distance = haversineDistanceKm(
      { latitude: 51.5074, longitude: -0.1278 },
      { latitude: 48.8566, longitude: 2.3522 },
    );
    expect(distance).toBeGreaterThan(330);
    expect(distance).toBeLessThan(350);
  });

  it("is symmetric", () => {
    const a = { latitude: -33.8688, longitude: 151.2093 };
    const b = { latitude: 35.6762, longitude: 139.6503 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 9);
  });

  it("handles the antimeridian", () => {
    const distance = haversineDistanceKm(
      { latitude: 0, longitude: 179 },
      { latitude: 0, longitude: -179 },
    );
    expect(distance).toBeGreaterThan(200);
    expect(distance).toBeLessThan(250);
  });
});

describe("coordinate validation", () => {
  it("accepts finite in-range coordinates", () => {
    expect(() => assertValidCoordinates({ latitude: 0, longitude: 0 })).not.toThrow();
    expect(() => assertValidCoordinates({ latitude: -90, longitude: 180 })).not.toThrow();
  });

  it("rejects non-objects, non-finite and out-of-range values", () => {
    for (const value of [
      null,
      "0,0",
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      { latitude: Number.NaN, longitude: 0 },
      { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => assertValidCoordinates(value)).toThrow();
    }
  });
});

describe("distance formatting", () => {
  it("uses one decimal under 10 km and whole km above", () => {
    expect(formatDistanceKm(3.456)).toBe("3.5 km");
    expect(formatDistanceKm(1234)).toBe("1,234 km");
  });

  it("handles non-finite values", () => {
    expect(formatDistanceKm(Number.NaN)).toBe("—");
  });
});
