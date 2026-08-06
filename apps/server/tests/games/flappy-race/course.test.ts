import { obstacleLeftX, obstacleRightX } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import { FLAPPY_RACE_SERVER_CONSTANTS } from "../../../src/games/flappy-race/constants.js";
import { generateOpenings } from "../../../src/games/flappy-race/course.js";

const config = FLAPPY_RACE_SERVER_CONSTANTS;
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
    const minGapTop = config.UPPER_MARGIN;
    const maxGapTop = config.WORLD_HEIGHT - config.GAP_SIZE - config.LOWER_MARGIN;
    for (const gapTop of openings) {
      expect(gapTop).toBeGreaterThanOrEqual(minGapTop);
      expect(gapTop).toBeLessThanOrEqual(maxGapTop);
    }
  });

  it("places the first obstacle beyond the safe starting distance", () => {
    const leftX = obstacleLeftX(config, 0, config.COURSE_SPEED, 0);
    expect(leftX).toBe(config.WORLD_WIDTH + config.SAFE_START_DISTANCE);
  });

  it("emits a fixed deterministic pattern in E2E mode", () => {
    const openings = generateOpenings(config, "ignored", 6, true);
    expect(openings).toEqual([
      config.WORLD_HEIGHT - config.GAP_SIZE,
      0,
      config.WORLD_HEIGHT - config.GAP_SIZE,
      0,
      config.WORLD_HEIGHT - config.GAP_SIZE,
      0,
    ]);
  });

  it("derives obstacle positions from elapsed time without mutation", () => {
    const before = obstacleRightX(config, 3, config.COURSE_SPEED, 0);
    const after = obstacleRightX(config, 3, config.COURSE_SPEED, 1_000);
    expect(before - after).toBeCloseTo(config.COURSE_SPEED, 5);
  });
});
