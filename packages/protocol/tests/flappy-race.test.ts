import { describe, expect, it } from "vitest";

import {
  FLAPPY_RACE_CONSTANTS,
  FLAPPY_RACE_GAME_ID,
  FlappyRaceState,
  flapCommandSchema,
  flappyRaceCommandSchema,
  flapRejectionSchema,
  hasPassedObstacle,
  obstacleLeftX,
  obstacleRightX,
} from "../src/index.js";

const config = FLAPPY_RACE_CONSTANTS;

describe("flappy race flap command", () => {
  it("accepts a valid flap intent", () => {
    const result = flapCommandSchema.safeParse({ type: "flap", sequence: 7, roundNumber: 2 });
    expect(result.success).toBe(true);
  });

  it("rejects malformed sequences, rounds, and extra intent", () => {
    const invalid = [
      { type: "flap", sequence: 1.5, roundNumber: 1 },
      { type: "flap", sequence: Number.NaN, roundNumber: 1 },
      { type: "flap", sequence: 1, roundNumber: 0 },
      { type: "flap", sequence: 1, roundNumber: 1.5 },
      {
        type: "flap",
        sequence: 1,
        roundNumber: 1,
        sessionId: "forged-session",
        birdY: 0,
        vy: 0,
        winner: true,
      },
    ];
    for (const payload of invalid) {
      expect(flapCommandSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("discriminates the command union by type", () => {
    expect(flappyRaceCommandSchema.safeParse({ type: "jump" }).success).toBe(false);
    expect(
      flappyRaceCommandSchema.safeParse({ type: "flap", sequence: 1, roundNumber: 1 }).success,
    ).toBe(true);
  });
});

describe("flap rejection payload", () => {
  it("accepts a stable sequence, round, and reason", () => {
    const result = flapRejectionSchema.safeParse({
      sequence: 3,
      roundNumber: 2,
      reason: "old-round",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown reasons and extra fields", () => {
    expect(
      flapRejectionSchema.safeParse({
        sequence: 3,
        roundNumber: 2,
        reason: "forged",
      }).success,
    ).toBe(false);
    expect(
      flapRejectionSchema.safeParse({
        sequence: 3,
        roundNumber: 2,
        reason: "rate-limited",
        winner: true,
      }).success,
    ).toBe(false);
  });
});

describe("course geometry", () => {
  it("places the first obstacle beyond the safe starting distance", () => {
    expect(obstacleLeftX(config, 0, config.COURSE_SPEED, 0)).toBe(
      config.WORLD_WIDTH + config.SAFE_START_DISTANCE,
    );
  });

  it("derives obstacle positions from elapsed time without mutation", () => {
    const before = obstacleRightX(config, 3, config.COURSE_SPEED, 0);
    const after = obstacleRightX(config, 3, config.COURSE_SPEED, 1_000);
    expect(before - after).toBeCloseTo(config.COURSE_SPEED, 5);
  });

  it("awards progress only after the obstacle right edge passes the bird", () => {
    const passMs =
      ((config.WORLD_WIDTH + config.SAFE_START_DISTANCE + config.OBSTACLE_WIDTH - config.BIRD_X) /
        config.COURSE_SPEED) *
      1000;
    const justBeforeMs = passMs - 1;
    expect(hasPassedObstacle(config, 0, config.COURSE_SPEED, justBeforeMs)).toBe(false);
    const justAfterMs = passMs + 1;
    expect(hasPassedObstacle(config, 0, config.COURSE_SPEED, justAfterMs)).toBe(true);
  });
});

describe("flappy race synchronized state", () => {
  it("initialises with safe public defaults", () => {
    const state = new FlappyRaceState();
    expect(state.gameId).toBe("");
    expect(state.roomCode).toBe("");
    expect(state.hostSessionId).toBe("");
    expect(state.phase).toBe("lobby");
    expect(state.roundNumber).toBe(0);
    expect(state.totalRounds).toBe(0);
    expect(state.countdownEndsAt).toBe(0);
    expect(state.courseElapsedMs).toBe(0);
    expect(state.resultsEndsAt).toBe(0);
    expect(state.courseSpeed).toBe(0);
    expect(state.obstacleOpenings.length).toBe(0);
    expect(state.roundWinnerSessionIds.length).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.result).toBeNull();
    expect("courseSeed" in state).toBe(false);
    expect("settings" in state).toBe(false);
  });

  it("exposes the stable game id constant", () => {
    expect(FLAPPY_RACE_GAME_ID).toBe("flappy-race");
  });
});
