import { describe, expect, it } from "vitest";

import {
  PONG_CONSTANTS,
  PONG_EDGE_ROTATION,
  PONG_GAME_ID,
  PongBallState,
  PongPlayerState,
  PongState,
  paddleRect,
  pongCommandSchema,
  pongPaddleMoveSchema,
  pongPaddleStopSchema,
  pongRejectionSchema,
} from "../src/index.js";

describe("pong paddle commands", () => {
  it("accepts valid move and stop intents", () => {
    expect(
      pongPaddleMoveSchema.safeParse({ type: "paddle_move", sequence: 7, target: 0.25 }).success,
    ).toBe(true);
    expect(pongPaddleStopSchema.safeParse({ type: "paddle_stop", sequence: 8 }).success).toBe(true);
  });

  it("rejects malformed targets, sequences, and extra fields", () => {
    const invalid = [
      { type: "paddle_move", sequence: 1.5, target: 0.5 },
      { type: "paddle_move", sequence: Number.NaN, target: 0.5 },
      { type: "paddle_move", sequence: 1, target: -0.1 },
      { type: "paddle_move", sequence: 1, target: 1.1 },
      { type: "paddle_stop", sequence: 1, target: 0.5 },
      { type: "paddle_move", sequence: 1, target: 0.5, x: 999, y: 999, score: 10 },
      { type: "paddle_stop", sequence: 1, sessionId: "forged", winner: true },
    ];
    for (const payload of invalid) {
      expect(pongPaddleMoveSchema.safeParse(payload).success).toBe(false);
      expect(pongPaddleStopSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("discriminates the command union by type", () => {
    expect(pongCommandSchema.safeParse({ type: "jump" }).success).toBe(false);
    expect(
      pongCommandSchema.safeParse({ type: "paddle_move", sequence: 1, target: 0 }).success,
    ).toBe(true);
    expect(pongCommandSchema.safeParse({ type: "paddle_stop", sequence: 2 }).success).toBe(true);
  });
});

describe("pong rejection payload", () => {
  it("accepts a stable sequence and reason", () => {
    const result = pongRejectionSchema.safeParse({ sequence: 3, reason: "rate-limited" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown reasons and extra fields", () => {
    expect(pongRejectionSchema.safeParse({ sequence: 3, reason: "forged" }).success).toBe(false);
    expect(
      pongRejectionSchema.safeParse({ sequence: 3, reason: "stale-sequence", score: 10 }).success,
    ).toBe(false);
  });
});

describe("pong geometry", () => {
  it("exposes stable shared constants", () => {
    expect(PONG_GAME_ID).toBe("pong");
    expect(PONG_CONSTANTS.WORLD_SIZE).toBe(600);
    expect(PONG_CONSTANTS.TARGET_SCORE).toBe(10);
    expect(PONG_CONSTANTS.MAX_BALLS_BY_PLAYERS[2]).toBe(2);
    expect(PONG_CONSTANTS.MAX_BALLS_BY_PLAYERS[8]).toBe(5);
    expect(PONG_CONSTANTS.MIN_PLAYERS).toBe(2);
    expect(PONG_CONSTANTS.MAX_PLAYERS).toBe(8);
  });

  it("rotates every defended edge to the local bottom with consistent handedness", () => {
    expect(PONG_EDGE_ROTATION.bottom).toBe(0);
    expect(PONG_EDGE_ROTATION.right).toBe(90);
    expect(PONG_EDGE_ROTATION.top).toBe(180);
    expect(PONG_EDGE_ROTATION.left).toBe(270);
  });

  it("places paddles just inside their world edge", () => {
    const top = paddleRect({ worldEdge: "top", paddleCenter: 300, paddleLength: 200 });
    expect(top).toEqual({ x: 200, y: 0, width: 200, height: PONG_CONSTANTS.PADDLE_THICKNESS });
    const bottom = paddleRect({ worldEdge: "bottom", paddleCenter: 300, paddleLength: 200 });
    expect(bottom).toEqual({
      x: 200,
      y: PONG_CONSTANTS.WORLD_SIZE - PONG_CONSTANTS.PADDLE_THICKNESS,
      width: 200,
      height: PONG_CONSTANTS.PADDLE_THICKNESS,
    });
    const left = paddleRect({ worldEdge: "left", paddleCenter: 300, paddleLength: 200 });
    expect(left).toEqual({ x: 0, y: 200, width: PONG_CONSTANTS.PADDLE_THICKNESS, height: 200 });
    const right = paddleRect({ worldEdge: "right", paddleCenter: 300, paddleLength: 200 });
    expect(right).toEqual({
      x: PONG_CONSTANTS.WORLD_SIZE - PONG_CONSTANTS.PADDLE_THICKNESS,
      y: 200,
      width: PONG_CONSTANTS.PADDLE_THICKNESS,
      height: 200,
    });
  });
});

describe("pong synchronized state", () => {
  it("initialises with safe public defaults", () => {
    const state = new PongState();
    expect(state.gameId).toBe("");
    expect(state.roomCode).toBe("");
    expect(state.hostSessionId).toBe("");
    expect(state.phase).toBe("lobby");
    expect(state.countdownEndsAt).toBe(0);
    expect(state.matchElapsedMs).toBe(0);
    expect(state.ballSpeed).toBe(0);
    expect(state.paddleSpeed).toBe(0);
    expect(state.desiredBallCount).toBe(0);
    expect(state.lastGoalDefenderSessionId).toBe("");
    expect(state.lastGoalScorerSessionId).toBe("");
    expect(state.lastGoalAt).toBe(0);
    expect(state.balls.size).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.result).toBeNull();
    expect("seed" in state).toBe(false);
    expect("settings" in state).toBe(false);
  });

  it("initialises ball and player rows with safe defaults", () => {
    const ball = new PongBallState();
    expect(ball.id).toBe("");
    expect(ball.x).toBe(0);
    expect(ball.y).toBe(0);
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
    expect(ball.ownerSessionId).toBe("");
    expect(ball.spawnState).toBe("warning");
    expect(ball.spawnsAt).toBe(0);

    const player = new PongPlayerState();
    expect(player.name).toBe("");
    expect(player.connectionStatus).toBe("connected");
    expect(player.worldEdge).toBe("bottom");
    expect(player.openingStart).toBe(0);
    expect(player.openingEnd).toBe(0);
    expect(player.paddleCenter).toBe(0);
    expect(player.score).toBe(0);
  });
});
