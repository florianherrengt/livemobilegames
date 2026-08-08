import { describe, expect, it } from "vitest";

import {
  COIN_RUSH_GAME_ID,
  CoinRushState,
  coinRushCommandSchema,
  coinRushMoveRejectionSchema,
  coinRushMoveSchema,
  manhattanDistance,
  vehicleLeftEdge,
} from "../src/index.js";

describe("coin rush move command", () => {
  it("accepts a valid swipe intent", () => {
    const result = coinRushMoveSchema.safeParse({
      type: "move",
      sequence: 7,
      direction: "up",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed sequences, directions, and extra intent", () => {
    const invalid = [
      { type: "move", sequence: 1.5, direction: "up" },
      { type: "move", sequence: Number.NaN, direction: "up" },
      { type: "move", sequence: -1, direction: "up" },
      { type: "move", sequence: Number.MAX_SAFE_INTEGER + 1, direction: "up" },
      { type: "move", sequence: 1, direction: "diagonal" },
      { type: "move", sequence: 1 },
      {
        type: "move",
        sequence: 1,
        direction: "up",
        sessionId: "forged-session",
        x: 4,
        y: 8,
        score: 99,
      },
    ];
    for (const payload of invalid) {
      expect(coinRushMoveSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("discriminates the command union by type", () => {
    expect(coinRushCommandSchema.safeParse({ type: "jump" }).success).toBe(false);
    expect(
      coinRushCommandSchema.safeParse({ type: "move", sequence: 1, direction: "left" }).success,
    ).toBe(true);
  });
});

describe("coin rush move rejection", () => {
  it("accepts a stable sequence and reason", () => {
    const result = coinRushMoveRejectionSchema.safeParse({
      sequence: 3,
      reason: "not-eligible",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown reasons and extra fields", () => {
    expect(
      coinRushMoveRejectionSchema.safeParse({
        sequence: 3,
        reason: "forged",
      }).success,
    ).toBe(false);
    expect(
      coinRushMoveRejectionSchema.safeParse({
        sequence: 3,
        reason: "rate-limited",
        winner: true,
      }).success,
    ).toBe(false);
  });
});

describe("coin rush shared geometry", () => {
  it("computes Manhattan distance", () => {
    expect(manhattanDistance({ col: 1, row: 2 }, { col: 4, row: 6 })).toBe(7);
    expect(manhattanDistance({ col: 4, row: 6 }, { col: 4, row: 6 })).toBe(0);
  });

  it("moves the vehicle stream right for a positive direction", () => {
    const row = { direction: 1, speed: 2, offset: 1, spacing: 8 };
    expect(vehicleLeftEdge(row, 0)).toBe(1);
    expect(vehicleLeftEdge(row, 1_000)).toBe(3);
    expect(vehicleLeftEdge(row, 4_000)).toBe(1);
  });

  it("moves the vehicle stream left for a negative direction and wraps", () => {
    const row = { direction: -1, speed: 2, offset: 1, spacing: 8 };
    expect(vehicleLeftEdge(row, 500)).toBe(0);
    expect(vehicleLeftEdge(row, 1_000)).toBe(7);
  });

  it("returns zero for safe rows", () => {
    const row = { direction: 0, speed: 0, offset: 0, spacing: 0 };
    expect(vehicleLeftEdge(row, 9_999)).toBe(0);
  });
});

describe("coin rush synchronized state", () => {
  it("initialises with safe public defaults", () => {
    const state = new CoinRushState();
    expect(state.gameId).toBe("");
    expect(state.roomCode).toBe("");
    expect(state.hostSessionId).toBe("");
    expect(state.phase).toBe("lobby");
    expect(state.roundNumber).toBe(0);
    expect(state.totalRounds).toBe(0);
    expect(state.countdownEndsAt).toBe(0);
    expect(state.roundResultEndsAt).toBe(0);
    expect(state.elapsedMs).toBe(0);
    expect(state.suddenDeath).toBe(false);
    expect(state.rows.length).toBe(0);
    expect(state.coins.size).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.roundWinnerSessionIds.length).toBe(0);
    expect(state.result).toBeNull();
    expect("seed" in state).toBe(false);
    expect("pendingMoves" in state).toBe(false);
  });

  it("exposes the stable game id constant", () => {
    expect(COIN_RUSH_GAME_ID).toBe("coin-rush");
  });
});
