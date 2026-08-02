import { describe, expect, it } from "vitest";

import { collisionObstacleIndex, updateClearedCount } from "../src/collision.js";
import { FLAPPY_RACE_CONFIG } from "../src/constants.js";

const config = FLAPPY_RACE_CONFIG;
const SPEED = config.courseSpeed;

function makePlayer(cleared: number) {
  return { clearedObstacleCount: cleared, nextObstacleIndex: cleared };
}

function elapsedForObstacleLeftX(index: number, x: number): number {
  const base = config.worldWidth + config.safeStartDistance + index * config.obstacleSpacing;
  return ((base - x) / SPEED) * 1000;
}

describe("obstacle progress", () => {
  it("increments only after the whole bird passes the trailing edge", () => {
    const openings = [200, 300, 400];
    const player = makePlayer(0);
    // Right edge is still ahead of the bird's left edge.
    const justBefore = elapsedForObstacleLeftX(0, config.birdX + 1);
    updateClearedCount(player, openings, SPEED, justBefore, config);
    expect(player.clearedObstacleCount).toBe(0);

    // Right edge passes the bird's left edge.
    const justAfter = elapsedForObstacleLeftX(0, config.birdX - config.obstacleWidth - 1);
    updateClearedCount(player, openings, SPEED, justAfter, config);
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
    // Obstacle 1 overlaps the bird horizontally.
    const elapsed = elapsedForObstacleLeftX(0, config.birdX + 10);
    // Bird sits below the gap (gap 200-410, bird 600-630).
    const hit = collisionObstacleIndex(player, 600, openings, SPEED, elapsed, config);
    expect(hit).toBe(0);
    expect(player.clearedObstacleCount).toBe(0);
  });

  it("keeps progress at 11 when crashing into obstacle 12", () => {
    const openings = Array.from({ length: 15 }, () => 200);
    const player = makePlayer(11);
    const elapsed = elapsedForObstacleLeftX(11, config.birdX + 10);
    const hit = collisionObstacleIndex(player, 600, openings, SPEED, elapsed, config);
    expect(hit).toBe(11);
    expect(player.clearedObstacleCount).toBe(11);
  });

  it("does not collide with an obstacle the bird is inside the gap of", () => {
    const openings = [200];
    const player = makePlayer(0);
    const elapsed = elapsedForObstacleLeftX(0, config.birdX + 10);
    const birdY = 300;
    const gapBottom = 200 + config.gapSize;
    expect(birdY).toBeGreaterThan(200);
    expect(birdY + config.birdHeight).toBeLessThanOrEqual(gapBottom);
    expect(collisionObstacleIndex(player, birdY, openings, SPEED, elapsed, config)).toBeNull();
  });

  it("checks only a bounded obstacle window", () => {
    const openings = Array.from({ length: 50 }, () => 200);
    const player = makePlayer(30);
    const farElapsed = elapsedForObstacleLeftX(30, -100_000);
    // The bird is far past obstacle 30; obstacle 31 is still far ahead.
    expect(collisionObstacleIndex(player, 400, openings, SPEED, farElapsed, config)).toBeNull();
  });
});
