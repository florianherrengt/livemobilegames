/**
 * Shared Kart Racing track geometry.
 *
 * The server uses this geometry for authoritative movement, collisions,
 * checkpoints, falling, respawning, crate placement, and the starting grid.
 * The web renderer uses the same module so the drawn world matches the
 * authoritative world. The track is deliberately static data: it is public,
 * never secret, and shared exactly like the Flappy Race course geometry.
 */

export interface TrackPoint {
  x: number;
  y: number;
}

export interface TrackLine {
  from: TrackPoint;
  to: TrackPoint;
}

export interface TrackCircle {
  x: number;
  y: number;
  radius: number;
}

export interface TrackRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrackPolygon {
  points: readonly TrackPoint[];
}

export interface CheckpointLine {
  /** Point on the centerline the checkpoint crosses. */
  x: number;
  y: number;
  /** Unit tangent in the race direction; crossing is detected against it. */
  dx: number;
  dy: number;
  /** Perpendicular unit vector from the centre to the road edge. */
  perpX: number;
  perpY: number;
  from: TrackPoint;
  to: TrackPoint;
  halfWidth: number;
}

export interface KartRacingTrack {
  id: string;
  name: string;
  centerline: readonly TrackPoint[];
  roadHalfWidth: number;
  /** Centerline index of the finish line. */
  finishIndex: number;
  /** Centerline indices of required checkpoints, in race order (not including finish). */
  checkpointIndexes: readonly number[];
  walls: readonly TrackLine[];
  obstacles: readonly TrackCircle[];
  slowZones: readonly TrackRectangle[];
  fallZones: readonly TrackPolygon[];
  crateSpawnPoints: readonly TrackPoint[];
  gridPositions: readonly TrackPoint[];
  /** Radians; the direction karts face on the grid. */
  startingHeading: number;
}

/**
 * The first track: a wide-starting, rounded-rectangle circuit that teaches
 * every mechanic in the game brief. Direction of travel is clockwise.
 */
export const KART_RACING_TRACK: KartRacingTrack = {
  id: "retro-circuit",
  name: "Retro Circuit",
  centerline: [
    { x: 250, y: 1050 },
    { x: 550, y: 1050 },
    { x: 850, y: 1050 },
    { x: 1150, y: 1050 },
    { x: 1350, y: 1050 },
    { x: 1450, y: 980 },
    { x: 1510, y: 880 },
    { x: 1510, y: 700 },
    { x: 1510, y: 520 },
    { x: 1510, y: 340 },
    { x: 1450, y: 240 },
    { x: 1350, y: 170 },
    { x: 1150, y: 170 },
    { x: 850, y: 170 },
    { x: 550, y: 170 },
    { x: 350, y: 170 },
    { x: 250, y: 240 },
    { x: 190, y: 340 },
    { x: 190, y: 520 },
    { x: 190, y: 700 },
    { x: 190, y: 880 },
    { x: 250, y: 980 },
  ],
  roadHalfWidth: 95,
  finishIndex: 0,
  checkpointIndexes: [5, 9, 12, 16, 20],
  walls: [
    { from: { x: 150, y: 1150 }, to: { x: 1460, y: 1150 } },
    { from: { x: 1460, y: 1150 }, to: { x: 1620, y: 900 } },
    { from: { x: 1620, y: 900 }, to: { x: 1620, y: 250 } },
    { from: { x: 1620, y: 250 }, to: { x: 1460, y: 80 } },
    { from: { x: 1460, y: 80 }, to: { x: 150, y: 80 } },
    { from: { x: 150, y: 80 }, to: { x: 80, y: 250 } },
    { from: { x: 80, y: 250 }, to: { x: 80, y: 900 } },
    { from: { x: 80, y: 900 }, to: { x: 150, y: 1150 } },
  ],
  obstacles: [
    { x: 1470, y: 800, radius: 34 },
    { x: 1560, y: 620, radius: 34 },
    { x: 1470, y: 440, radius: 34 },
    { x: 600, y: 170, radius: 34 },
    { x: 900, y: 170, radius: 34 },
  ],
  slowZones: [{ x: 1250, y: 1000, width: 180, height: 90 }],
  fallZones: [
    {
      points: [
        { x: 1350, y: 450 },
        { x: 1350, y: 850 },
        { x: 450, y: 850 },
        { x: 450, y: 450 },
      ],
    },
    {
      points: [
        { x: 95, y: 340 },
        { x: 150, y: 340 },
        { x: 150, y: 880 },
        { x: 95, y: 880 },
      ],
    },
    {
      points: [
        { x: 230, y: 340 },
        { x: 285, y: 340 },
        { x: 285, y: 880 },
        { x: 230, y: 880 },
      ],
    },
  ],
  crateSpawnPoints: [
    { x: 500, y: 1050 },
    { x: 750, y: 1030 },
    { x: 1000, y: 1070 },
    { x: 1200, y: 1050 },
    { x: 1380, y: 990 },
    { x: 1510, y: 950 },
    { x: 1510, y: 730 },
    { x: 1510, y: 520 },
    { x: 1510, y: 320 },
    { x: 350, y: 170 },
    { x: 750, y: 170 },
    { x: 1000, y: 170 },
    { x: 1250, y: 170 },
    { x: 190, y: 880 },
    { x: 190, y: 650 },
    { x: 190, y: 430 },
    { x: 240, y: 300 },
  ],
  gridPositions: [
    { x: 600, y: 1050 },
    { x: 700, y: 985 },
    { x: 700, y: 1115 },
    { x: 800, y: 1050 },
    { x: 900, y: 985 },
    { x: 900, y: 1115 },
    { x: 1000, y: 1050 },
    { x: 1100, y: 1050 },
  ],
  startingHeading: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeVector(dx: number, dy: number): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return { x: 1, y: 0 };
  }
  return { x: dx / length, y: dy / length };
}

/** Unit tangent at a centerline index, using the neighbouring points. */
export function trackTangent(track: KartRacingTrack, index: number): { x: number; y: number } {
  const length = track.centerline.length;
  const previous = track.centerline[(index - 1 + length) % length] ?? { x: 0, y: 0 };
  const next = track.centerline[(index + 1) % length] ?? { x: 0, y: 0 };
  return normalizeVector(next.x - previous.x, next.y - previous.y);
}

/** Unit tangent of the segment leaving a centerline index (race direction). */
export function trackForwardTangent(
  track: KartRacingTrack,
  index: number,
): { x: number; y: number } {
  const length = track.centerline.length;
  const current = track.centerline[index] ?? { x: 0, y: 0 };
  const next = track.centerline[(index + 1) % length] ?? { x: 0, y: 0 };
  return normalizeVector(next.x - current.x, next.y - current.y);
}

export function checkpointLine(track: KartRacingTrack, centerlineIndex: number): CheckpointLine {
  const point = track.centerline[centerlineIndex] ?? { x: 0, y: 0 };
  const tangent = trackTangent(track, centerlineIndex);
  const perpX = -tangent.y;
  const perpY = tangent.x;
  const halfWidth = track.roadHalfWidth;
  return {
    x: point.x,
    y: point.y,
    dx: tangent.x,
    dy: tangent.y,
    perpX,
    perpY,
    halfWidth,
    from: {
      x: point.x + perpX * halfWidth,
      y: point.y + perpY * halfWidth,
    },
    to: {
      x: point.x - perpX * halfWidth,
      y: point.y - perpY * halfWidth,
    },
  };
}

export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distance: number; x: number; y: number; t: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  const t =
    lengthSquared === 0 ? 0 : clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared, 0, 1);
  const x = ax + abx * t;
  const y = ay + aby * t;
  return { distance: Math.hypot(px - x, py - y), x, y, t };
}

/** Points from startIndex to endIndex following the closed centerline order. */
export function polylineArcPoints(
  points: readonly TrackPoint[],
  startIndex: number,
  endIndex: number,
): TrackPoint[] {
  const length = points.length;
  const ordered: TrackPoint[] = [];
  let index = ((startIndex % length) + length) % length;
  const end = ((endIndex % length) + length) % length;
  for (;;) {
    const point = points[index];
    if (point !== undefined) {
      ordered.push(point);
    }
    if (index === end) {
      break;
    }
    index = (index + 1) % length;
  }
  if (startIndex % length === endIndex % length) {
    // start === end means one full loop: the loop above pushed only the start
    // point, so append every remaining point until the loop returns to start.
    let next = (end + 1) % length;
    while (next !== end) {
      const point = points[next];
      if (point !== undefined) {
        ordered.push(point);
      }
      next = (next + 1) % length;
    }
  }
  return ordered;
}

export interface NearestOnPolyline {
  x: number;
  y: number;
  distance: number;
  /** Distance along the path from the start point to the nearest point. */
  arcLength: number;
  totalLength: number;
  fraction: number;
}

export function nearestOnPolyline(
  point: TrackPoint,
  points: readonly TrackPoint[],
  startIndex: number,
  endIndex: number,
): NearestOnPolyline {
  const ordered = polylineArcPoints(points, startIndex, endIndex);
  let best: NearestOnPolyline = {
    x: ordered[0]?.x ?? point.x,
    y: ordered[0]?.y ?? point.y,
    distance: Number.POSITIVE_INFINITY,
    arcLength: 0,
    totalLength: 0,
    fraction: 0,
  };
  let passed = 0;
  for (let index = 0; index < ordered.length - 1; index++) {
    const a = ordered[index];
    const b = ordered[index + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    const segment = distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y);
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment.distance < best.distance) {
      best = {
        x: segment.x,
        y: segment.y,
        distance: segment.distance,
        arcLength: passed + segmentLength * segment.t,
        totalLength: 0,
        fraction: 0,
      };
    }
    passed += segmentLength;
  }
  best.totalLength = passed;
  best.fraction = best.totalLength === 0 ? 0 : best.arcLength / best.totalLength;
  return best;
}

export function pointInRectangle(x: number, y: number, rectangle: TrackRectangle): boolean {
  return (
    x >= rectangle.x &&
    x <= rectangle.x + rectangle.width &&
    y >= rectangle.y &&
    y <= rectangle.y + rectangle.height
  );
}

export function pointInPolygon(x: number, y: number, polygon: TrackPolygon): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.points.length - 1;
    index < polygon.points.length;
    previous = index++
  ) {
    const current = polygon.points[index];
    const last = polygon.points[previous];
    if (current === undefined || last === undefined) {
      continue;
    }
    const intersects =
      current.y > y !== last.y > y &&
      x < ((last.x - current.x) * (y - current.y)) / (last.y - current.y) + current.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * A point `distance` pixels ahead of `startIndex` along the closed
 * centreline, following the race direction. Used for respawn positions by the
 * server and for steering lookahead rendering by the browser.
 */
export function pointAlongCenterline(
  track: KartRacingTrack,
  startIndex: number,
  distance: number,
): TrackPoint {
  const points = polylineArcPoints(track.centerline, startIndex, startIndex);
  let remaining = Math.max(0, distance);
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length) {
      const t = length === 0 ? 0 : remaining / length;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
    remaining -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}

export function circleIntersectsSegment(
  cx: number,
  cy: number,
  radius: number,
  from: TrackPoint,
  to: TrackPoint,
): boolean {
  return distanceToSegment(cx, cy, from.x, from.y, to.x, to.y).distance <= radius;
}

/**
 * True when the movement segment from prev to curr crosses the checkpoint
 * line in the race direction and the crossing point is on the road.
 */
export function crossesCheckpointForward(
  prev: TrackPoint,
  curr: TrackPoint,
  line: CheckpointLine,
): boolean {
  const previousSide = (prev.x - line.x) * line.dx + (prev.y - line.y) * line.dy;
  const currentSide = (curr.x - line.x) * line.dx + (curr.y - line.y) * line.dy;
  if (!(previousSide <= 0 && currentSide > 0)) {
    return false;
  }
  const t = previousSide / (previousSide - currentSide);
  const ix = prev.x + (curr.x - prev.x) * t;
  const iy = prev.y + (curr.y - prev.y) * t;
  const across = (ix - line.x) * line.perpX + (iy - line.y) * line.perpY;
  return Math.abs(across) <= line.halfWidth;
}

/** True when the movement segment crosses the checkpoint line backwards. */
export function crossesCheckpointBackward(
  prev: TrackPoint,
  curr: TrackPoint,
  line: CheckpointLine,
): boolean {
  const previousSide = (prev.x - line.x) * line.dx + (prev.y - line.y) * line.dy;
  const currentSide = (curr.x - line.x) * line.dx + (curr.y - line.y) * line.dy;
  if (!(previousSide >= 0 && currentSide < 0)) {
    return false;
  }
  const t = previousSide / (previousSide - currentSide);
  const ix = prev.x + (curr.x - prev.x) * t;
  const iy = prev.y + (curr.y - prev.y) * t;
  const across = (ix - line.x) * line.perpX + (iy - line.y) * line.perpY;
  return Math.abs(across) <= line.halfWidth;
}

/**
 * Progress fraction (0..1) from the last passed gate to the next gate along
 * the centreline. `nextGateIndex` is the index into the required checkpoint
 * list (0..checkpoints.length); a value equal to checkpoints.length means the
 * finish line is next. Karts that have not crossed the last gate yet clamp to
 * 0, so shortcuts cannot advance race position.
 */
export function progressTowardNextGate(
  track: KartRacingTrack,
  position: TrackPoint,
  nextGateIndex: number,
): number {
  const gates = [track.finishIndex, ...track.checkpointIndexes];
  const requiredCount = track.checkpointIndexes.length;
  if (nextGateIndex < 0 || nextGateIndex > requiredCount) {
    return 0;
  }
  const endIndex = gates[nextGateIndex];
  const startIndex = nextGateIndex === 0 ? track.finishIndex : gates[nextGateIndex - 1];
  if (endIndex === undefined || startIndex === undefined) {
    return 0;
  }
  const nearest = nearestOnPolyline(position, track.centerline, startIndex, endIndex);
  // A kart that is off the road (for example cutting across the infield) has
  // not made progress along the track toward the next checkpoint. Clamping it
  // to zero keeps shortcuts from inflating live race position.
  if (nearest.distance > track.roadHalfWidth + 6) {
    return 0;
  }
  return nearest.fraction;
}

/** Total arc length of the full closed circuit. */
export function trackLength(track: KartRacingTrack): number {
  const points = track.centerline;
  let total = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (a !== undefined && b !== undefined) {
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return total;
}

/** Nearest point and distance to the road centreline. */
export function nearestRoadPoint(track: KartRacingTrack, position: TrackPoint): NearestOnPolyline {
  return nearestOnPolyline(position, track.centerline, 0, track.centerline.length - 1);
}
