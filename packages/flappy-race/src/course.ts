import seedrandom from "seedrandom";

import type { FlappyRaceConfig } from "./constants.js";

/**
 * Deterministic course generation.
 *
 * In normal mode openings are derived only from the seed: the same seed and
 * configuration always produce the same sequence. In E2E mode the generator
 * emits a fixed alternating pattern (gap at the bottom for even obstacles,
 * gap at the top for odd ones) so browser and integration tests can force
 * deterministic collisions without any cheat controls.
 */
export function generateOpenings(
  config: FlappyRaceConfig,
  seed: string,
  count: number,
  e2eMode: boolean,
): number[] {
  const openings: number[] = [];
  if (e2eMode) {
    for (let index = 0; index < count; index++) {
      openings.push(index % 2 === 0 ? config.worldHeight - config.gapSize : 0);
    }
    return openings;
  }

  const rng = seedrandom(seed);
  const minGapTop = config.upperMargin;
  const maxGapTop = config.worldHeight - config.gapSize - config.lowerMargin;
  const range = maxGapTop - minGapTop + 1;
  for (let index = 0; index < count; index++) {
    const gapTop = minGapTop + Math.floor(rng() * range);
    openings.push(gapTop);
  }
  return openings;
}

/** Left edge x of an obstacle at the given course elapsed time. */
export function obstacleLeftX(
  config: FlappyRaceConfig,
  obstacleIndex: number,
  courseSpeed: number,
  elapsedMs: number,
): number {
  const base =
    config.worldWidth + config.safeStartDistance + obstacleIndex * config.obstacleSpacing;
  return base - (courseSpeed * elapsedMs) / 1000;
}

export function obstacleRightX(
  config: FlappyRaceConfig,
  obstacleIndex: number,
  courseSpeed: number,
  elapsedMs: number,
): number {
  return obstacleLeftX(config, obstacleIndex, courseSpeed, elapsedMs) + config.obstacleWidth;
}

/**
 * True once the whole bird has moved beyond the obstacle's trailing (right)
 * edge. Progress is awarded exactly once, by callers that advance a monotonic
 * next-obstacle index.
 */
export function hasPassedObstacle(
  config: FlappyRaceConfig,
  obstacleIndex: number,
  courseSpeed: number,
  elapsedMs: number,
): boolean {
  return obstacleRightX(config, obstacleIndex, courseSpeed, elapsedMs) < config.birdX;
}
