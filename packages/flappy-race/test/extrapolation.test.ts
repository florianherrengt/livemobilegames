import { describe, expect, it } from "vitest";

import { FLAPPY_RACE_CONFIG } from "../src/constants.js";
import { extrapolateBirdY } from "../src/physics.js";

describe("client bird extrapolation", () => {
  it("returns the authoritative position at zero delta", () => {
    expect(extrapolateBirdY(400, -430, 0, FLAPPY_RACE_CONFIG)).toBe(400);
  });

  it("projects the bird along the authoritative velocity", () => {
    const y = extrapolateBirdY(400, -430, 100, FLAPPY_RACE_CONFIG);
    expect(y).toBeCloseTo(400 - 43, 5);
  });

  it("clamps the extrapolated bird inside the world", () => {
    const maxY = FLAPPY_RACE_CONFIG.worldHeight - FLAPPY_RACE_CONFIG.birdHeight;
    expect(extrapolateBirdY(1, -1_000, 500, FLAPPY_RACE_CONFIG)).toBe(0);
    expect(extrapolateBirdY(maxY - 1, 1_000, 500, FLAPPY_RACE_CONFIG)).toBe(maxY);
  });

  it("ignores negative deltas", () => {
    expect(extrapolateBirdY(400, -430, -50, FLAPPY_RACE_CONFIG)).toBe(400);
  });
});
