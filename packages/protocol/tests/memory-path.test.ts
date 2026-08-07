import { describe, expect, it } from "vitest";

import {
  MEMORY_PATH_CONSTANTS,
  MEMORY_PATH_GAME_ID,
  MemoryPathRoundResultState,
  MemoryPathState,
  memoryPathCommandSchema,
  memoryPathMoveRejectionSchema,
  memoryPathMoveSchema,
} from "../src/index.js";

describe("memory path move command", () => {
  it("accepts a valid joystick intent", () => {
    const result = memoryPathMoveSchema.safeParse({
      type: "move",
      sequence: 7,
      roundNumber: 2,
      x: -0.5,
      y: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a stop intent at the origin", () => {
    const result = memoryPathMoveSchema.safeParse({
      type: "move",
      sequence: 8,
      roundNumber: 2,
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed vectors, rounds, sequences, and extra intent", () => {
    const invalid = [
      { type: "move", sequence: 1.5, roundNumber: 1, x: 0, y: 0 },
      { type: "move", sequence: Number.NaN, roundNumber: 1, x: 0, y: 0 },
      { type: "move", sequence: 1, roundNumber: 0, x: 0, y: 0 },
      { type: "move", sequence: 1, roundNumber: 1.5, x: 0, y: 0 },
      { type: "move", sequence: 1, roundNumber: 1, x: 1.1, y: 0 },
      { type: "move", sequence: 1, roundNumber: 1, x: 0, y: -2 },
      {
        type: "move",
        sequence: 1,
        roundNumber: 1,
        x: 0,
        y: 0,
        sessionId: "forged-session",
        positionX: 0,
        winner: true,
      },
    ];
    for (const payload of invalid) {
      expect(memoryPathMoveSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("discriminates the command union by type", () => {
    expect(memoryPathCommandSchema.safeParse({ type: "jump" }).success).toBe(false);
    expect(
      memoryPathCommandSchema.safeParse({
        type: "move",
        sequence: 1,
        roundNumber: 1,
        x: 0,
        y: 0,
      }).success,
    ).toBe(true);
  });
});

describe("memory path move rejection", () => {
  it("accepts a stable sequence, round, and reason", () => {
    const result = memoryPathMoveRejectionSchema.safeParse({
      sequence: 3,
      roundNumber: 2,
      reason: "old-round",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown reasons and extra fields", () => {
    expect(
      memoryPathMoveRejectionSchema.safeParse({
        sequence: 3,
        roundNumber: 2,
        reason: "forged",
      }).success,
    ).toBe(false);
    expect(
      memoryPathMoveRejectionSchema.safeParse({
        sequence: 3,
        roundNumber: 2,
        reason: "rate-limited",
        winner: true,
      }).success,
    ).toBe(false);
  });
});

describe("memory path synchronized state", () => {
  it("initialises with safe public defaults", () => {
    const state = new MemoryPathState();
    expect(state.gameId).toBe("");
    expect(state.roomCode).toBe("");
    expect(state.hostSessionId).toBe("");
    expect(state.phase).toBe("lobby");
    expect(state.roundNumber).toBe(0);
    expect(state.totalRounds).toBe(0);
    expect(state.suddenDeath).toBe(false);
    expect(state.preparingEndsAt).toBe(0);
    expect(state.previewEndsAt).toBe(0);
    expect(state.raceEndsAt).toBe(0);
    expect(state.resultsEndsAt).toBe(0);
    expect(state.raceElapsedMs).toBe(0);
    expect(state.pathVisible).toBe(false);
    expect(state.opponentsVisible).toBe(false);
    expect(state.pathWidth).toBe(0);
    expect(state.movementSpeed).toBe(0);
    expect(state.startX).toBe(MEMORY_PATH_CONSTANTS.START_X);
    expect(state.finishY).toBe(MEMORY_PATH_CONSTANTS.FINISH_Y);
    expect(state.routePoints.length).toBe(0);
    expect(state.landmarks.length).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.roundResult).toBeNull();
    expect(state.matchResult).toBeNull();
    expect("seed" in state).toBe(false);
    expect("inputX" in state).toBe(false);
  });

  it("exposes the stable game id constant", () => {
    expect(MEMORY_PATH_GAME_ID).toBe("memory-path");
  });

  it("initialises round results with a stable winner label", () => {
    const roundResult = new MemoryPathRoundResultState();
    expect(roundResult.winnerLabel).toBe("");
  });
});
