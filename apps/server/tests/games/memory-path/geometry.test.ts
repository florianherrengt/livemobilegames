import { describe, expect, it } from "vitest";

import {
  distanceToPolyline,
  distanceToSegment,
  normalizeInput,
  pathTotalLength,
  projectOnPath,
  segmentIntersectsCircle,
  segmentsIntersect,
} from "../../../src/games/memory-path/geometry.js";

const VERTICAL = [
  { x: 100, y: 700 },
  { x: 100, y: 500 },
  { x: 100, y: 300 },
  { x: 100, y: 140 },
];

describe("Memory Path geometry", () => {
  it("measures point-to-segment distance including beyond endpoints", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    expect(distanceToSegment({ x: 50, y: 30 }, start, end)).toBeCloseTo(30, 5);
    expect(distanceToSegment({ x: 120, y: 10 }, start, end)).toBeCloseTo(Math.hypot(20, 10), 5);
  });

  it("keeps points on the corridor at zero polyline distance", () => {
    expect(distanceToPolyline({ x: 100, y: 400 }, VERTICAL)).toBeCloseTo(0, 5);
  });

  it("computes monotonic progress along the centreline", () => {
    const total = pathTotalLength(VERTICAL);
    const start = projectOnPath({ x: 100, y: 700 }, VERTICAL);
    const middle = projectOnPath({ x: 100, y: 420 }, VERTICAL);
    const end = projectOnPath({ x: 100, y: 140 }, VERTICAL);
    expect(start.distanceAlong).toBe(0);
    expect(middle.distanceAlong).toBeGreaterThan(0);
    expect(middle.distanceAlong).toBeLessThan(total);
    expect(end.distanceAlong).toBeCloseTo(total, 5);
  });

  it("normalises diagonal joystick input so diagonals do not move faster", () => {
    expect(normalizeInput(1, 1)).toEqual({
      x: 1 / Math.SQRT2,
      y: 1 / Math.SQRT2,
    });
    expect(normalizeInput(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("detects segment intersections", () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }),
    ).toBe(true);
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }),
    ).toBe(false);
  });

  it("detects finish-circle crossings on a movement segment", () => {
    const finish = { x: 195, y: 140 };
    expect(segmentIntersectsCircle({ x: 195, y: 180 }, { x: 195, y: 100 }, finish, 30)).toBe(true);
    expect(segmentIntersectsCircle({ x: 195, y: 500 }, { x: 195, y: 400 }, finish, 30)).toBe(false);
  });
});
