import { describe, expect, it } from "vitest";

import { FLAPPY_RACE_SERVER_CONSTANTS } from "../../../src/games/flappy-race/constants.js";
import {
  consumeFlapRateLimit,
  createFlapTimestampMap,
} from "../../../src/games/flappy-race/rate-limit.js";

describe("flap rate limiting", () => {
  it("accepts flaps under the per-second cap", () => {
    const timestamps = createFlapTimestampMap();
    for (let index = 0; index < FLAPPY_RACE_SERVER_CONSTANTS.MAX_FLAPS_PER_SECOND; index++) {
      expect(
        consumeFlapRateLimit(FLAPPY_RACE_SERVER_CONSTANTS, timestamps, "p1", 1_000 + index),
      ).toBe(true);
    }
  });

  it("rejects flaps over the per-second cap", () => {
    const timestamps = createFlapTimestampMap();
    for (let index = 0; index < FLAPPY_RACE_SERVER_CONSTANTS.MAX_FLAPS_PER_SECOND + 5; index++) {
      const accepted = consumeFlapRateLimit(
        FLAPPY_RACE_SERVER_CONSTANTS,
        timestamps,
        "p1",
        1_000 + index,
      );
      expect(accepted).toBe(index < FLAPPY_RACE_SERVER_CONSTANTS.MAX_FLAPS_PER_SECOND);
    }
  });

  it("lets the window slide after one second", () => {
    const timestamps = createFlapTimestampMap();
    for (let index = 0; index < FLAPPY_RACE_SERVER_CONSTANTS.MAX_FLAPS_PER_SECOND; index++) {
      consumeFlapRateLimit(FLAPPY_RACE_SERVER_CONSTANTS, timestamps, "p1", 1_000);
    }
    expect(consumeFlapRateLimit(FLAPPY_RACE_SERVER_CONSTANTS, timestamps, "p1", 1_000)).toBe(false);
    expect(consumeFlapRateLimit(FLAPPY_RACE_SERVER_CONSTANTS, timestamps, "p1", 2_050)).toBe(true);
  });

  it("tracks players independently", () => {
    const timestamps = createFlapTimestampMap();
    for (let index = 0; index < FLAPPY_RACE_SERVER_CONSTANTS.MAX_FLAPS_PER_SECOND; index++) {
      consumeFlapRateLimit(FLAPPY_RACE_SERVER_CONSTANTS, timestamps, "p1", 1_000);
    }
    expect(consumeFlapRateLimit(FLAPPY_RACE_SERVER_CONSTANTS, timestamps, "p2", 1_000)).toBe(true);
  });
});
