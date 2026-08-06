import { describe, expect, it } from "vitest";

import { FLAPPY_RACE_SERVER_CONSTANTS } from "../../../src/games/flappy-race/constants.js";
import { stepBird } from "../../../src/games/flappy-race/physics.js";

const config = FLAPPY_RACE_SERVER_CONSTANTS;
const DT = config.SIMULATION_STEP_MS;

describe("bird vertical movement", () => {
  it("applies an upward velocity impulse on flap", () => {
    const result = stepBird({ y: 400, vy: 0 }, true, DT, config);
    expect(result.vy).toBe(-config.FLAP_IMPULSE);
    expect(result.y).toBeLessThan(400);
  });

  it("pulls the bird downward with gravity", () => {
    const result = stepBird({ y: 400, vy: 0 }, false, DT, config);
    expect(result.vy).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(400);
  });

  it("clamps downward velocity to the configured maximum", () => {
    const result = stepBird({ y: 400, vy: config.MAX_FALL_SPEED }, false, DT, config);
    expect(result.vy).toBe(config.MAX_FALL_SPEED);
  });

  it("clamps the bird at the ceiling and cancels upward velocity", () => {
    const result = stepBird({ y: 1, vy: -1_000 }, false, DT, config);
    expect(result.y).toBe(0);
    expect(result.vy).toBe(0);
  });

  it("clamps the bird at the ground and cancels downward velocity", () => {
    const maxY = config.WORLD_HEIGHT - config.BIRD_HEIGHT;
    const result = stepBird({ y: maxY - 1, vy: 1_000 }, false, DT, config);
    expect(result.y).toBe(maxY);
    expect(result.vy).toBe(0);
  });

  it("never leaves the world and never bounces", () => {
    const maxY = config.WORLD_HEIGHT - config.BIRD_HEIGHT;
    for (const startY of [0, 100, maxY]) {
      for (const startVy of [-2_000, -500, 0, 500, 2_000]) {
        const result = stepBird({ y: startY, vy: startVy }, false, DT, config);
        expect(result.y).toBeGreaterThanOrEqual(0);
        expect(result.y).toBeLessThanOrEqual(maxY);
        if (startVy < 0 && result.y === 0) {
          expect(result.vy).toBe(0);
        }
        if (startVy > 0 && result.y === maxY) {
          expect(result.vy).toBe(0);
        }
      }
    }
  });
});
