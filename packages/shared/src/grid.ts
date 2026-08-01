import { TILE_PITCH } from "./constants.js";

/** Chebyshev distance adjacency: horizontal, vertical and diagonal are all hops. */
export function isAdjacent(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): boolean {
  return Math.max(Math.abs(targetX - sourceX), Math.abs(targetY - sourceY)) === 1;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth ease-in-out used for hop interpolation. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Horizontal easing for hops (ease-out quad). Unlike easeInOut it starts with
 * real horizontal speed, so the character moves out of the tile immediately
 * while arcing instead of rising in place first.
 */
export function hopEaseOut(t: number): number {
  return t * (2 - t);
}

/**
 * Arena side length for a given number of participating players.
 * Grows with the player count with no arbitrary gameplay cap.
 */
export function computeArenaSide(playerCount: number): number {
  const desiredPlatformCount = Math.max(49, playerCount * 6);
  const side = Math.ceil(Math.sqrt(desiredPlatformCount));
  return side % 2 === 0 ? side + 1 : side;
}

/** Top-left world coordinate of the arena so its centre lands on (0, 0). */
export function arenaOriginX(arenaSide: number, pitch = TILE_PITCH): number {
  return (-arenaSide * pitch) / 2;
}

export function arenaOriginY(arenaSide: number, pitch = TILE_PITCH): number {
  return (-arenaSide * pitch) / 2;
}

/** World coordinates of a platform centre. */
export function platformCenterX(gridX: number, arenaSide: number, pitch = TILE_PITCH): number {
  return arenaOriginX(arenaSide, pitch) + gridX * pitch + pitch / 2;
}

export function platformCenterY(gridY: number, arenaSide: number, pitch = TILE_PITCH): number {
  return arenaOriginY(arenaSide, pitch) + gridY * pitch + pitch / 2;
}
