import { describe, expect, it } from "vitest";
import { assertValidCoordinates, formatDistanceKm, haversineDistanceKm } from "../src/distance.js";

describe("haversineDistanceKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(
      haversineDistanceKm({ latitude: 10, longitude: 20 }, { latitude: 10, longitude: 20 }),
    ).toBe(0);
  });

  it("matches the known London -> Paris distance (approximately 343 km)", () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    const km = haversineDistanceKm(london, paris);
    // Known great-circle distance is ~343.5 km.
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(346);
  });

  it("handles coordinates across the antimeridian", () => {
    // Two points 2 degrees apart across the date line, on the equator.
    const a = { latitude: 0, longitude: 179 };
    const b = { latitude: 0, longitude: -179 };
    const km = haversineDistanceKm(a, b);
    // 2 degrees of longitude at the equator ≈ 111.32 * 2 = ~222.6 km
    expect(km).toBeGreaterThan(220);
    expect(km).toBeLessThan(225);
  });

  it("handles north and south hemisphere", () => {
    const north = { latitude: 60, longitude: 0 };
    const south = { latitude: -60, longitude: 0 };
    const km = haversineDistanceKm(north, south);
    // 120 degrees of latitude ≈ 120 * 111.19 ≈ 13343 km
    expect(km).toBeGreaterThan(13_300);
    expect(km).toBeLessThan(13_400);
  });

  it("is symmetric", () => {
    const a = { latitude: 35.6762, longitude: 139.6503 };
    const b = { latitude: -22.9068, longitude: -43.1729 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 5);
  });
});

describe("assertValidCoordinates", () => {
  it("accepts valid coordinates", () => {
    expect(() => assertValidCoordinates({ latitude: 0, longitude: 0 })).not.toThrow();
    expect(() => assertValidCoordinates({ latitude: -90, longitude: -180 })).not.toThrow();
    expect(() => assertValidCoordinates({ latitude: 90, longitude: 180 })).not.toThrow();
  });

  it("rejects non-objects", () => {
    expect(() => assertValidCoordinates(null)).toThrow();
    expect(() => assertValidCoordinates("12,34")).toThrow();
    expect(() => assertValidCoordinates(42)).toThrow();
  });

  it("rejects non-finite numbers", () => {
    expect(() => assertValidCoordinates({ latitude: NaN, longitude: 0 })).toThrow();
    expect(() => assertValidCoordinates({ latitude: 0, longitude: Infinity })).toThrow();
  });

  it("rejects out-of-range latitude", () => {
    expect(() => assertValidCoordinates({ latitude: 90.1, longitude: 0 })).toThrow();
    expect(() => assertValidCoordinates({ latitude: -90.1, longitude: 0 })).toThrow();
  });

  it("rejects out-of-range longitude", () => {
    expect(() => assertValidCoordinates({ latitude: 0, longitude: 180.1 })).toThrow();
    expect(() => assertValidCoordinates({ latitude: 0, longitude: -180.1 })).toThrow();
  });
});

describe("formatDistanceKm", () => {
  it("uses one decimal place under 10 km", () => {
    expect(formatDistanceKm(0)).toBe("0.0 km");
    expect(formatDistanceKm(5.555)).toBe("5.6 km");
    expect(formatDistanceKm(9.999)).toBe("10.0 km");
  });

  it("uses whole kilometres at 10 km or more", () => {
    expect(formatDistanceKm(10)).toBe("10 km");
    expect(formatDistanceKm(343.556)).toBe("344 km");
    expect(formatDistanceKm(20_015)).toBe("20,015 km");
  });

  it("renders a dash for non-finite input", () => {
    expect(formatDistanceKm(Number.NaN)).toBe("—");
  });
});
