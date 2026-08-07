import type { GolfCourse } from "@phone-party/protocol";

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Cumulative route length at each route point, plus total route length. */
export function buildRouteDistances(course: GolfCourse): number[] {
  const distances = [0];
  for (let index = 1; index < course.route.length; index++) {
    const previous = course.route[index - 1];
    const current = course.route[index];
    if (!previous || !current) {
      throw new Error(`Golf course ${course.id}: route is malformed`);
    }
    distances.push(
      (distances[index - 1] ?? 0) + Math.hypot(current.x - previous.x, current.y - previous.y),
    );
  }
  return distances;
}

/** Distance along the route at the closest point on the polyline. */
export function routeProjection(
  course: GolfCourse,
  distances: readonly number[],
  point: Point,
): number {
  let bestDistance = Number.POSITIVE_INFINITY;
  let best = 0;
  for (let index = 0; index < course.route.length - 1; index++) {
    const start = course.route[index];
    const end = course.route[index + 1];
    if (!start || !end) {
      continue;
    }
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
          );
    const closestX = start.x + t * dx;
    const closestY = start.y + t * dy;
    const distanceSquared = Math.hypot(point.x - closestX, point.y - closestY) ** 2;
    if (distanceSquared < bestDistance) {
      bestDistance = distanceSquared;
      best = (distances[index] ?? 0) + t * Math.hypot(dx, dy);
    }
  }
  return best;
}

/** Route distance at the midpoint of a progress gate. */
export function gateRouteDistance(
  course: GolfCourse,
  distances: readonly number[],
  gateIndex: number,
): number {
  const gate = course.progressGates[gateIndex];
  if (!gate) {
    return routeProjection(course, distances, {
      x: (course.finishLine.x1 + course.finishLine.x2) / 2,
      y: (course.finishLine.y1 + course.finishLine.y2) / 2,
    });
  }
  return routeProjection(course, distances, {
    x: (gate.x1 + gate.x2) / 2,
    y: (gate.y1 + gate.y2) / 2,
  });
}

export interface ProgressParts {
  raceProgress: number;
  sectionProgress: number;
}

/**
 * Stable course-defined race progress: the route distance of the latest valid
 * gate plus the clamped fraction of the current section. Straight-line
 * distance to the finish is never used, so loops and near-self-touching
 * course sections cannot distort ordering.
 */
export function computeProgress(
  course: GolfCourse,
  distances: readonly number[],
  position: Point,
  latestGateIndex: number,
): ProgressParts {
  const projected = routeProjection(course, distances, position);
  const base = latestGateIndex >= 0 ? gateRouteDistance(course, distances, latestGateIndex) : 0;
  const next = gateRouteDistance(course, distances, latestGateIndex + 1);
  const sectionLength = Math.max(1, next - base);
  const sectionProgress = Math.max(0, Math.min(1, (projected - base) / sectionLength));
  return {
    raceProgress: base + sectionProgress * sectionLength,
    sectionProgress,
  };
}

/**
 * Returns the intersection point and parameter along the first segment when
 * two segments cross, or null. Non-zero-length segments only.
 */
export function segmentIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): { point: Point; t: number } | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denominator = dax * dby - day * dbx;
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }
  const cx = b1.x - a1.x;
  const cy = b1.y - a1.y;
  const t = (cx * dby - cy * dbx) / denominator;
  const u = (cx * day - cy * dax) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return null;
  }
  return {
    point: { x: a1.x + t * dax, y: a1.y + t * day },
    t,
  };
}

export function distanceToSegment(point: Point, segment: Segment): number {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / lengthSquared),
        );
  const closestX = segment.x1 + t * dx;
  const closestY = segment.y1 + t * dy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}
