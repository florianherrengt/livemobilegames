import {
  type CheckpointLine,
  checkpointLine,
  circleIntersectsSegment,
  distanceToSegment,
  KART_RACING_TRACK,
  type KartRacingTrack,
  nearestRoadPoint,
  pointInPolygon,
  pointInRectangle,
  pointAlongCenterline as protocolPointAlongCenterline,
  type TrackPoint,
  trackForwardTangent,
} from "@phone-party/protocol";

import { KART_RACING_SERVER_CONSTANTS } from "./constants.js";

export function isOnRoad(track: KartRacingTrack, x: number, y: number, tolerance = 0): boolean {
  return nearestRoadPoint(track, { x, y }).distance <= track.roadHalfWidth + tolerance;
}

export function isInSlowZone(track: KartRacingTrack, x: number, y: number): boolean {
  return track.slowZones.some((zone) => pointInRectangle(x, y, zone));
}

export function isInFallZone(track: KartRacingTrack, x: number, y: number): boolean {
  if (!isOnRoad(track, x, y, 3)) {
    return true;
  }
  return track.fallZones.some((zone) => pointInPolygon(x, y, zone));
}

export interface CircleHit {
  x: number;
  y: number;
  nx: number;
  ny: number;
  distance: number;
  radius: number;
}

export function nearestWallHit(
  track: KartRacingTrack,
  x: number,
  y: number,
  radius: number,
): CircleHit | null {
  let best: CircleHit | null = null;
  for (const wall of track.walls) {
    if (
      !circleIntersectsSegment(
        x,
        y,
        radius + KART_RACING_SERVER_CONSTANTS.WALL_RADIUS,
        wall.from,
        wall.to,
      )
    ) {
      continue;
    }
    const hit = distanceToSegment(x, y, wall.from.x, wall.from.y, wall.to.x, wall.to.y);
    const dx = x - hit.x;
    const dy = y - hit.y;
    const length = Math.hypot(dx, dy) || 1;
    const candidate: CircleHit = {
      x: hit.x,
      y: hit.y,
      nx: dx / length,
      ny: dy / length,
      distance: hit.distance,
      radius: KART_RACING_SERVER_CONSTANTS.WALL_RADIUS,
    };
    if (best === null || candidate.distance < best.distance) {
      best = candidate;
    }
  }
  return best;
}

export function nearestObstacleHit(
  track: KartRacingTrack,
  x: number,
  y: number,
  radius: number,
): CircleHit | null {
  let best: CircleHit | null = null;
  for (const obstacle of track.obstacles) {
    const dx = x - obstacle.x;
    const dy = y - obstacle.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= radius + obstacle.radius) {
      continue;
    }
    const length = distance || 1;
    const candidate: CircleHit = {
      x: obstacle.x,
      y: obstacle.y,
      nx: dx / length,
      ny: dy / length,
      distance,
      radius: obstacle.radius,
    };
    if (best === null || candidate.distance < best.distance) {
      best = candidate;
    }
  }
  return best;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministically activates a subset of the track's hand-defined crate
 * spawn points. Picks greedily with a minimum spacing so active crates do not
 * cluster into one blob.
 */
export function selectActiveCrates(
  track: KartRacingTrack,
  seed: string,
  count: number,
): Array<{ id: string; x: number; y: number }> {
  const rng = createRng(seed);
  const shuffled = [...track.crateSpawnPoints];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const a = shuffled[index];
    const b = shuffled[swapIndex];
    if (a !== undefined && b !== undefined) {
      shuffled[index] = b;
      shuffled[swapIndex] = a;
    }
  }
  const selected: TrackPoint[] = [];
  const minSpacing = KART_RACING_SERVER_CONSTANTS.CRATE_MIN_SPACING;
  for (const point of shuffled) {
    if (
      selected.every(
        (existing) => Math.hypot(existing.x - point.x, existing.y - point.y) >= minSpacing,
      )
    ) {
      selected.push(point);
    }
    if (selected.length >= count) {
      break;
    }
  }
  return selected.map((point, index) => ({
    id: `crate-${index}`,
    x: point.x,
    y: point.y,
  }));
}

export function pointAlongCenterline(
  track: KartRacingTrack,
  startIndex: number,
  distance: number,
): TrackPoint {
  return protocolPointAlongCenterline(track, startIndex, distance);
}

export interface RespawnCandidate {
  x: number;
  y: number;
  heading: number;
}

function laneOffset(point: TrackPoint, heading: number, offset: number): TrackPoint {
  const tangent = { x: Math.cos(heading), y: Math.sin(heading) };
  return {
    x: point.x - tangent.y * offset,
    y: point.y + tangent.x * offset,
  };
}

/**
 * Finds a safe respawn point just ahead of the most recently passed gate.
 * Tries lateral lanes first, then points further ahead, and prefers spots not
 * occupied by another kart. Falls back to a deterministic ahead point.
 */
export function safeRespawnPoint(
  track: KartRacingTrack,
  gateIndex: number,
  occupied: (x: number, y: number) => boolean,
): RespawnCandidate {
  const distances = [70, 110, 150, 190, 230, 40, 270, 310, 350, 390];
  const lanes = [0, 40, -40, 80, -80, 120, -120];
  for (const ahead of distances) {
    const center = pointAlongCenterline(track, gateIndex, ahead);
    const tangentAt = trackForwardTangent(track, gateIndex);
    const localHeading = Math.atan2(tangentAt.y, tangentAt.x);
    for (const lane of lanes) {
      const candidate = laneOffset(center, localHeading, lane);
      if (
        isOnRoad(track, candidate.x, candidate.y, 4) &&
        !isInFallZone(track, candidate.x, candidate.y) &&
        !isInSlowZone(track, candidate.x, candidate.y) &&
        nearestObstacleHit(
          track,
          candidate.x,
          candidate.y,
          KART_RACING_SERVER_CONSTANTS.KART_RADIUS,
        ) === null &&
        nearestWallHit(
          track,
          candidate.x,
          candidate.y,
          KART_RACING_SERVER_CONSTANTS.KART_RADIUS,
        ) === null &&
        !occupied(candidate.x, candidate.y)
      ) {
        return { x: candidate.x, y: candidate.y, heading: localHeading };
      }
    }
  }
  // Last resort: a verified centreline point ahead of the gate. On the
  // bundled track this is always on drivable road outside fall zones.
  const center = pointAlongCenterline(track, gateIndex, 120);
  const tangentAt = trackForwardTangent(track, gateIndex);
  return { x: center.x, y: center.y, heading: Math.atan2(tangentAt.y, tangentAt.x) };
}

export function checkpointForGate(track: KartRacingTrack, gateIndex: number): CheckpointLine {
  return checkpointLine(track, gateIndex);
}

export function gateCenterlineIndex(track: KartRacingTrack, nextCheckpointIndex: number): number {
  const requiredCount = track.checkpointIndexes.length;
  if (nextCheckpointIndex < requiredCount) {
    return track.checkpointIndexes[nextCheckpointIndex] ?? track.finishIndex;
  }
  return track.finishIndex;
}

export function lastGateIndexForPlayer(
  track: KartRacingTrack,
  player: { nextCheckpointIndex: number },
): number {
  if (player.nextCheckpointIndex === 0) {
    return track.finishIndex;
  }
  return track.checkpointIndexes[player.nextCheckpointIndex - 1] ?? track.finishIndex;
}

export function normalizeAngle(angle: number): number {
  let result = angle % (Math.PI * 2);
  if (result <= -Math.PI) {
    result += Math.PI * 2;
  } else if (result > Math.PI) {
    result -= Math.PI * 2;
  }
  return result;
}

export function angleDifference(from: number, to: number): number {
  return normalizeAngle(to - from);
}

export { KART_RACING_TRACK };
