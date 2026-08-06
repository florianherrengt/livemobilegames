import { hasPassedObstacle, obstacleLeftX } from "@phone-party/protocol";

import type { FlappyRaceServerConstants } from "./constants.js";
import type { RuntimePlayer } from "./types.js";

export interface BirdRect {
  y: number;
}

/**
 * Awards progress exactly once per fully passed obstacle by advancing the
 * player's monotonic next-obstacle index.
 */
export function updateClearedCount(
  player: Pick<RuntimePlayer, "clearedObstacleCount" | "nextObstacleIndex">,
  openings: readonly number[],
  courseSpeed: number,
  elapsedMs: number,
  config: FlappyRaceServerConstants,
): void {
  while (
    player.nextObstacleIndex < openings.length &&
    hasPassedObstacle(config, player.nextObstacleIndex, courseSpeed, elapsedMs)
  ) {
    player.clearedObstacleCount += 1;
    player.nextObstacleIndex += 1;
  }
}

/** True when the bird rectangle intersects the obstacle column's gap rectangle. */
export function birdIntersectsObstacle(
  config: FlappyRaceServerConstants,
  bird: BirdRect,
  gapTop: number,
): boolean {
  const birdBottom = bird.y + config.BIRD_HEIGHT;
  const gapBottom = gapTop + config.GAP_SIZE;
  return bird.y < gapTop || birdBottom > gapBottom;
}

/**
 * Checks the small window of obstacles that can possibly overlap the bird's
 * fixed horizontal position. Returns the obstacle index on collision.
 */
export function collisionObstacleIndex(
  player: Pick<RuntimePlayer, "nextObstacleIndex">,
  birdY: number,
  openings: readonly number[],
  courseSpeed: number,
  elapsedMs: number,
  config: FlappyRaceServerConstants,
): number | null {
  const from = Math.max(0, player.nextObstacleIndex - 1);
  const to = Math.min(openings.length - 1, player.nextObstacleIndex + 1);
  const birdRight = config.BIRD_X + config.BIRD_WIDTH;
  for (let index = from; index <= to; index++) {
    const leftX = obstacleLeftX(config, index, courseSpeed, elapsedMs);
    if (leftX + config.OBSTACLE_WIDTH <= config.BIRD_X || leftX >= birdRight) {
      continue;
    }
    const gapTop = openings[index];
    if (gapTop !== undefined && birdIntersectsObstacle(config, { y: birdY }, gapTop)) {
      return index;
    }
  }
  return null;
}
