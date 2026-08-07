import { describe, expect, it } from "vitest";

import {
  GOLF_COURSE,
  GOLF_GAME_ID,
  GOLF_MAX_DRAG_PX,
  GolfRaceState,
  golfCourseSchema,
  golfRaceCommandSchema,
  golfShotRejectionSchema,
  golfShotSchema,
} from "../src/index.js";

describe("golf shot command", () => {
  it("accepts a valid shot intent", () => {
    const result = golfShotSchema.safeParse({
      type: "shot",
      sequence: 7,
      roundNumber: 2,
      aimX: -80,
      aimY: 200,
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed sequences, aims, rounds, and extra intent", () => {
    const invalid = [
      { type: "shot", sequence: 1.5, roundNumber: 1, aimX: 0, aimY: 0 },
      { type: "shot", sequence: Number.NaN, roundNumber: 1, aimX: 0, aimY: 0 },
      { type: "shot", sequence: 1, roundNumber: 0, aimX: 0, aimY: 0 },
      { type: "shot", sequence: 1, roundNumber: 1, aimX: Number.NaN, aimY: 0 },
      { type: "shot", sequence: 1, roundNumber: 1, aimX: -GOLF_MAX_DRAG_PX - 1, aimY: 0 },
      {
        type: "shot",
        sequence: 1,
        roundNumber: 1,
        aimX: 0,
        aimY: 0,
        sessionId: "forged-session",
        positionX: 999,
        winner: true,
      },
    ];
    for (const payload of invalid) {
      expect(golfShotSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("discriminates the command union by type", () => {
    expect(golfRaceCommandSchema.safeParse({ type: "putt" }).success).toBe(false);
    expect(
      golfRaceCommandSchema.safeParse({
        type: "shot",
        sequence: 1,
        roundNumber: 1,
        aimX: 0,
        aimY: 50,
      }).success,
    ).toBe(true);
  });
});

describe("golf shot rejection payload", () => {
  it("accepts a stable sequence, round, and reason", () => {
    const result = golfShotRejectionSchema.safeParse({
      sequence: 3,
      roundNumber: 2,
      reason: "timer-expired",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown reasons and extra fields", () => {
    expect(
      golfShotRejectionSchema.safeParse({
        sequence: 3,
        roundNumber: 2,
        reason: "forged",
      }).success,
    ).toBe(false);
    expect(
      golfShotRejectionSchema.safeParse({
        sequence: 3,
        roundNumber: 2,
        reason: "not-your-turn",
        winner: true,
      }).success,
    ).toBe(false);
  });
});

describe("golf course data", () => {
  it("validates the shipped course", () => {
    const result = golfCourseSchema.safeParse(GOLF_COURSE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("arcade-loop");
      expect(result.data.startingPositions).toHaveLength(8);
      expect(result.data.respawnPositions.length).toBeGreaterThan(0);
      expect(result.data.progressGates.length).toBeGreaterThan(1);
    }
  });

  it("rejects courses with missing or out-of-order gates", () => {
    const withoutGates = { ...GOLF_COURSE, progressGates: [] };
    expect(golfCourseSchema.safeParse(withoutGates).success).toBe(false);

    const reordered = {
      ...GOLF_COURSE,
      progressGates: [...GOLF_COURSE.progressGates].reverse(),
    };
    expect(golfCourseSchema.safeParse(reordered).success).toBe(false);
  });
});

describe("golf synchronized state", () => {
  it("initialises with safe public defaults", () => {
    const state = new GolfRaceState();
    expect(state.gameId).toBe("");
    expect(state.roomCode).toBe("");
    expect(state.hostSessionId).toBe("");
    expect(state.phase).toBe("lobby");
    expect(state.roundNumber).toBe(0);
    expect(state.totalRounds).toBe(0);
    expect(state.countdownEndsAt).toBe(0);
    expect(state.aimingEndsAt).toBe(0);
    expect(state.resultsEndsAt).toBe(0);
    expect(state.currentTurnSessionId).toBe("");
    expect(state.turnOrder.length).toBe(0);
    expect(state.turnIndex).toBe(0);
    expect(state.finishedCount).toBe(0);
    expect(state.roundWinnerSessionIds.length).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.result).toBeNull();
    expect("sequenceWindows" in state).toBe(false);
    expect("courseSeed" in state).toBe(false);
  });

  it("exposes the stable game id constant", () => {
    expect(GOLF_GAME_ID).toBe("golf");
  });
});
