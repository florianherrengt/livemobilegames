import { describe, expect, it } from "vitest";

import {
  collisionObstacleIndex,
  updateClearedCount,
} from "../../../src/games/flappy-race/collision.js";
import { FLAPPY_RACE_SERVER_CONSTANTS } from "../../../src/games/flappy-race/constants.js";

const config = FLAPPY_RACE_SERVER_CONSTANTS;
const SPEED = config.COURSE_SPEED;

function makePlayer(cleared: number) {
  return { clearedObstacleCount: cleared, nextObstacleIndex: cleared };
}

function elapsedForObstacleLeftX(index: number, x: number): number {
  const base = config.WORLD_WIDTH + config.SAFE_START_DISTANCE + index * config.OBSTACLE_SPACING;
  return ((base - x) / SPEED) * 1000;
}

describe("obstacle progress", () => {
  it("increments only after the whole bird passes the trailing edge", () => {
    const openings = [200, 300, 400];
    const player = makePlayer(0);
    const passMs =
      ((config.WORLD_WIDTH + config.SAFE_START_DISTANCE + config.OBSTACLE_WIDTH - config.BIRD_X) /
        SPEED) *
      1000;
    updateClearedCount(player, openings, SPEED, passMs - 1, config);
    expect(player.clearedObstacleCount).toBe(0);

    updateClearedCount(player, openings, SPEED, passMs + 1, config);
    expect(player.clearedObstacleCount).toBe(1);
    expect(player.nextObstacleIndex).toBe(1);
  });

  it("awards progress exactly once per obstacle", () => {
    const openings = [200, 300];
    const player = makePlayer(0);
    const far = elapsedForObstacleLeftX(1, -1_000);
    updateClearedCount(player, openings, SPEED, far, config);
    expect(player.clearedObstacleCount).toBe(2);
    updateClearedCount(player, openings, SPEED, far + 5_000, config);
    expect(player.clearedObstacleCount).toBe(2);
  });

  it("leaves progress at zero when crashing into obstacle 1", () => {
    const openings = [200];
    const player = makePlayer(0);
    const elapsed = elapsedForObstacleLeftX(0, config.BIRD_X + 10);
    const hit = collisionObstacleIndex(player, 600, openings, SPEED, elapsed, config);
    expect(hit).toBe(0);
    expect(player.clearedObstacleCount).toBe(0);
  });

  it("keeps progress at 11 when crashing into obstacle 12", () => {
    const openings = Array.from({ length: 15 }, () => 200);
    const player = makePlayer(11);
    const elapsed = elapsedForObstacleLeftX(11, config.BIRD_X + 10);
    const hit = collisionObstacleIndex(player, 600, openings, SPEED, elapsed, config);
    expect(hit).toBe(11);
    expect(player.clearedObstacleCount).toBe(11);
  });

  it("does not collide with an obstacle the bird is inside the gap of", () => {
    const openings = [200];
    const player = makePlayer(0);
    const elapsed = elapsedForObstacleLeftX(0, config.BIRD_X + 10);
    const birdY = 300;
    const gapBottom = 200 + config.GAP_SIZE;
    expect(birdY).toBeGreaterThan(200);
    expect(birdY + config.BIRD_HEIGHT).toBeLessThanOrEqual(gapBottom);
    expect(collisionObstacleIndex(player, birdY, openings, SPEED, elapsed, config)).toBeNull();
  });

  it("checks only a bounded obstacle window", () => {
    const openings = Array.from({ length: 50 }, () => 200);
    const player = makePlayer(30);
    const farElapsed = elapsedForObstacleLeftX(30, -100_000);
    expect(collisionObstacleIndex(player, 400, openings, SPEED, farElapsed, config)).toBeNull();
  });
});
