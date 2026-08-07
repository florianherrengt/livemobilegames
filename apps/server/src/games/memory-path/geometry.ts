export interface Point2D {
  x: number;
  y: number;
}

export interface Projection {
  /** Distance along the polyline from the first point to the projected point. */
  distanceAlong: number;
  /** Closest segment index; ties resolve to the earliest segment. */
  segmentIndex: number;
  /** Clamped parameter on the closest segment. */
  t: number;
}

export function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function distanceToPolyline(point: Point2D, points: readonly Point2D[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }
    closest = Math.min(closest, distanceToSegment(point, start, end));
  }
  return closest;
}

export function pathTotalLength(points: readonly Point2D[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }
    total += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return total;
}

/**
 * Projects a point onto the polyline along the route's centreline. The closest
 * segment is used, with ties resolved to the earliest segment so progress and
 * timeout ranking stay deterministic on simple, non-self-crossing routes.
 */
export function projectOnPath(point: Point2D, points: readonly Point2D[]): Projection {
  let bestSegment = 0;
  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let distanceBeforeBest = 0;
  let accumulated = 0;

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(
            1,
            Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
          );
    const distance = Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    if (distance < bestDistance - 1e-9) {
      bestSegment = index;
      bestT = t;
      bestDistance = distance;
      distanceBeforeBest = accumulated;
    }
    accumulated += Math.hypot(dx, dy);
  }

  const start = points[bestSegment];
  const end = points[bestSegment + 1];
  const segmentDx = (end?.x ?? start?.x ?? 0) - (start?.x ?? 0);
  const segmentDy = (end?.y ?? start?.y ?? 0) - (start?.y ?? 0);
  return {
    distanceAlong: distanceBeforeBest + Math.hypot(segmentDx * bestT, segmentDy * bestT),
    segmentIndex: bestSegment,
    t: bestT,
  };
}

/** Normalizes a raw joystick vector: diagonal input never moves faster than axial input. */
export function normalizeInput(x: number, y: number): { x: number; y: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.01) {
    return { x: 0, y: 0 };
  }
  const scale = Math.min(1, magnitude);
  return { x: (x / magnitude) * scale, y: (y / magnitude) * scale };
}

export function distanceBetweenPoints(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * True when the segment from `a` to `b` crosses or touches the circle centred
 * at `centre` with the given radius. Used for authoritative finish detection
 * so a player who crosses the finish line and leaves the corridor within the
 * same server update is still credited when the crossing point is valid.
 */
export function segmentIntersectsCircle(
  a: Point2D,
  b: Point2D,
  centre: Point2D,
  radius: number,
): boolean {
  return distanceToSegment(centre, a, b) <= radius;
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) < 1e-9) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function onSegment(a: Point2D, b: Point2D, c: Point2D): boolean {
  return (
    Math.min(a.x, b.x) - 1e-9 <= c.x &&
    c.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= c.y &&
    c.y <= Math.max(a.y, b.y) + 1e-9
  );
}

/** True when two finite segments properly intersect or share any point. */
export function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

/** Minimum distance between two finite segments, including endpoints. */
export function distanceBetweenSegments(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number {
  if (segmentsIntersect(a, b, c, d)) {
    return 0;
  }
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}
