import { describe, expect, it } from "vitest";

import {
  LIVE_DRAWING_GUESSING_CONSTANTS,
  LIVE_DRAWING_GUESSING_GAME_ID,
  LiveDrawingGuessingState,
  liveDrawingCommandSchema,
  liveDrawingDrawerBriefingSchema,
  liveDrawingDrawerRequestSchema,
  liveDrawingGuessFeedbackSchema,
  liveDrawingGuessSchema,
  liveDrawingStrokeSchema,
  liveDrawingUndoSchema,
} from "../src/index.js";

describe("live drawing command schemas", () => {
  it("accepts a valid stroke intent", () => {
    const result = liveDrawingStrokeSchema.safeParse({
      type: "stroke",
      strokeId: "stroke-1",
      color: "#000000",
      points: [0, 0, 100, 200, 1000, 1000],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a completed stroke", () => {
    const result = liveDrawingStrokeSchema.safeParse({
      type: "stroke",
      strokeId: "stroke-1",
      color: "#e02424",
      points: [10, 10],
      complete: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed strokes, forged fields, and oversized payloads", () => {
    const invalid = [
      { type: "stroke", strokeId: "", color: "#000000", points: [0, 0] },
      { type: "stroke", strokeId: "stroke-1", color: "#ffffff", points: [0, 0] },
      { type: "stroke", strokeId: "stroke-1", color: "#000000", points: [] },
      { type: "stroke", strokeId: "stroke-1", color: "#000000", points: [0] },
      { type: "stroke", strokeId: "stroke-1", color: "#000000", points: [0, 2000] },
      { type: "stroke", strokeId: "stroke-1", color: "#000000", points: [Number.NaN, 0] },
      {
        type: "stroke",
        strokeId: "stroke-1",
        color: "#000000",
        points: [0, 0],
        playerId: "forged",
        score: 99,
      },
      {
        type: "stroke",
        strokeId: "stroke-1",
        color: "#000000",
        points: Array.from({ length: 202 }, () => 0),
      },
    ];
    for (const payload of invalid) {
      expect(liveDrawingStrokeSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("accepts undo and guess intents and rejects extras", () => {
    expect(liveDrawingUndoSchema.safeParse({ type: "undo" }).success).toBe(true);
    expect(liveDrawingUndoSchema.safeParse({ type: "undo", strokeId: "x" }).success).toBe(false);
    expect(
      liveDrawingGuessSchema.safeParse({ type: "guess", text: "  Ice  Cream  " }).success,
    ).toBe(true);
    expect(liveDrawingGuessSchema.safeParse({ type: "guess", text: "   " }).success).toBe(false);
    expect(
      liveDrawingGuessSchema.safeParse({ type: "guess", text: "penguin", winner: true }).success,
    ).toBe(false);
  });

  it("discriminates the command union by type", () => {
    expect(liveDrawingCommandSchema.safeParse({ type: "erase" }).success).toBe(false);
    expect(liveDrawingCommandSchema.safeParse({ type: "undo" }).success).toBe(true);
    expect(
      liveDrawingCommandSchema.safeParse({
        type: "guess",
        text: "penguin",
      }).success,
    ).toBe(true);
    expect(
      liveDrawingCommandSchema.safeParse({
        type: "stroke",
        strokeId: "s",
        color: "#000000",
        points: [0, 0],
      }).success,
    ).toBe(true);
  });
});

describe("live drawing server-to-client messages", () => {
  it("accepts stable guess feedback reasons and rejects extras", () => {
    for (const kind of ["incorrect", "not-active", "not-guesser", "invalid"]) {
      expect(liveDrawingGuessFeedbackSchema.safeParse({ kind }).success).toBe(true);
    }
    expect(liveDrawingGuessFeedbackSchema.safeParse({ kind: "correct" }).success).toBe(false);
    expect(
      liveDrawingGuessFeedbackSchema.safeParse({ kind: "incorrect", word: "penguin" }).success,
    ).toBe(false);
  });

  it("accepts a private drawer briefing", () => {
    const result = liveDrawingDrawerBriefingSchema.safeParse({
      word: "penguin",
      category: "Animal",
      turnNumber: 1,
      roundNumber: 1,
      letterCount: 7,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a drawer request and rejects extras", () => {
    expect(liveDrawingDrawerRequestSchema.safeParse({}).success).toBe(true);
    expect(liveDrawingDrawerRequestSchema.safeParse({ word: "penguin" }).success).toBe(false);
  });
});

describe("live drawing synchronized state", () => {
  it("initialises with safe public defaults", () => {
    const state = new LiveDrawingGuessingState();
    expect(state.gameId).toBe("");
    expect(state.roomCode).toBe("");
    expect(state.hostSessionId).toBe("");
    expect(state.phase).toBe("lobby");
    expect(state.roundNumber).toBe(0);
    expect(state.totalRounds).toBe(0);
    expect(state.turnNumber).toBe(0);
    expect(state.totalTurns).toBe(0);
    expect(state.drawerPlayerId).toBe("");
    expect(state.wordCategory).toBe("");
    expect(state.letterPattern.length).toBe(0);
    expect(state.prepareEndsAt).toBe(0);
    expect(state.drawingEndsAt).toBe(0);
    expect(state.resultEndsAt).toBe(0);
    expect(state.roundSummaryEndsAt).toBe(0);
    expect(state.strokes.length).toBe(0);
    expect(state.lastResult).toBeNull();
    expect(state.result).toBeNull();
    expect(state.players.size).toBe(0);
    expect("word" in state).toBe(false);
    expect("reveal" in state).toBe(false);
  });

  it("exposes the stable game id and constants", () => {
    expect(LIVE_DRAWING_GUESSING_GAME_ID).toBe("live-drawing-guessing");
    expect(LIVE_DRAWING_GUESSING_CONSTANTS.TOTAL_ROUNDS).toBe(3);
    expect(LIVE_DRAWING_GUESSING_CONSTANTS.MIN_PLAYERS).toBe(2);
    expect(LIVE_DRAWING_GUESSING_CONSTANTS.MAX_PLAYERS).toBe(8);
    expect(LIVE_DRAWING_GUESSING_CONSTANTS.PALETTE).toContain("#000000");
  });
});
