import { describe, expect, it } from "vitest";
import { FLAPPY_RACE_CONFIG } from "../src/constants.js";
import { generateOpenings, obstacleLeftX, obstacleRightX } from "../src/course.js";

const config = FLAPPY_RACE_CONFIG;
const COUNT = 40;

describe("deterministic course generation", () => {
  it("produces the same openings for the same seed", () => {
    const first = generateOpenings(config, "unit-seed", COUNT, false);
    const second = generateOpenings(config, "unit-seed", COUNT, false);
    expect(first).toEqual(second);
    expect(first).toHaveLength(COUNT);
  });

  it("produces different openings for different seeds", () => {
    const first = generateOpenings(config, "unit-seed-a", COUNT, false);
    const second = generateOpenings(config, "unit-seed-b", COUNT, false);
    expect(first).not.toEqual(second);
  });

  it("keeps openings within the configured margins", () => {
    const openings = generateOpenings(config, "margins", 500, false);
    const minGapTop = config.upperMargin;
    const maxGapTop = config.worldHeight - config.gapSize - config.lowerMargin;
    for (const gapTop of openings) {
      expect(gapTop).toBeGreaterThanOrEqual(minGapTop);
      expect(gapTop).toBeLessThanOrEqual(maxGapTop);
    }
  });

  it("keeps gap size, spacing and speed constant", () => {
    const openings = generateOpenings(config, "constants", COUNT, false);
    for (let index = 0; index < openings.length - 1; index++) {
      const current = openings[index];
      const next = openings[index + 1];
      if (current === undefined || next === undefined) {
        throw new Error("opening missing");
      }
      // Gap size is the same by construction; openings only move the gap top.
      expect(next).not.toBe(current);
      const leftA = obstacleLeftX(config, index, config.courseSpeed, 1_000);
      const leftB = obstacleLeftX(config, index + 1, config.courseSpeed, 1_000);
      expect(leftB - leftA).toBe(config.obstacleSpacing);
    }
  });

  it("places the first obstacle beyond the safe starting distance", () => {
    const leftX = obstacleLeftX(config, 0, config.courseSpeed, 0);
    expect(leftX).toBe(config.worldWidth + config.safeStartDistance);
  });

  it("emits a fixed deterministic pattern in E2E mode", () => {
    const openings = generateOpenings(config, "ignored", 6, true);
    expect(openings).toEqual([
      config.worldHeight - config.gapSize,
      0,
      config.worldHeight - config.gapSize,
      0,
      config.worldHeight - config.gapSize,
      0,
    ]);
  });

  it("derives obstacle positions from elapsed time without mutation", () => {
    const before = obstacleRightX(config, 3, config.courseSpeed, 0);
    const after = obstacleRightX(config, 3, config.courseSpeed, 1_000);
    expect(before - after).toBeCloseTo(config.courseSpeed, 5);
  });
});
