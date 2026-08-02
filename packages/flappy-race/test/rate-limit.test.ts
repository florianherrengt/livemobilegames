import { describe, expect, it } from "vitest";

import { FLAPPY_RACE_CONFIG } from "../src/constants.js";
import { consumeFlapRateLimit, createFlapTimestampMap } from "../src/rate-limit.js";

describe("flap rate limiting", () => {
  it("accepts flaps under the per-second cap", () => {
    const timestamps = createFlapTimestampMap();
    for (let index = 0; index < FLAPPY_RACE_CONFIG.maxFlapsPerSecond; index++) {
      expect(consumeFlapRateLimit(FLAPPY_RACE_CONFIG, timestamps, "p1", 1_000 + index)).toBe(true);
    }
  });

  it("rejects flaps over the per-second cap", () => {
    const timestamps = createFlapTimestampMap();
    for (let index = 0; index < FLAPPY_RACE_CONFIG.maxFlapsPerSecond + 5; index++) {
      const accepted = consumeFlapRateLimit(FLAPPY_RACE_CONFIG, timestamps, "p1", 1_000 + index);
      expect(accepted).toBe(index < FLAPPY_RACE_CONFIG.maxFlapsPerSecond);
    }
  });

  it("lets the window slide after one second", () => {
    const timestamps = createFlapTimestampMap();
    for (let index = 0; index < FLAPPY_RACE_CONFIG.maxFlapsPerSecond; index++) {
      consumeFlapRateLimit(FLAPPY_RACE_CONFIG, timestamps, "p1", 1_000);
    }
    expect(consumeFlapRateLimit(FLAPPY_RACE_CONFIG, timestamps, "p1", 1_000)).toBe(false);
    expect(consumeFlapRateLimit(FLAPPY_RACE_CONFIG, timestamps, "p1", 2_050)).toBe(true);
  });

  it("tracks players independently", () => {
    const timestamps = createFlapTimestampMap();
    for (let index = 0; index < FLAPPY_RACE_CONFIG.maxFlapsPerSecond; index++) {
      consumeFlapRateLimit(FLAPPY_RACE_CONFIG, timestamps, "p1", 1_000);
    }
    expect(consumeFlapRateLimit(FLAPPY_RACE_CONFIG, timestamps, "p2", 1_000)).toBe(true);
  });
});
