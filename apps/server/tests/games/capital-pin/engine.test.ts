import { describe, expect, it } from "vitest";

import { CAPITALS } from "../../../src/games/capital-pin/capitals.js";
import { CapitalPinEngine } from "../../../src/games/capital-pin/engine.js";

function createEngine(now = () => 1_000): CapitalPinEngine {
  return new CapitalPinEngine(now, {
    totalRounds: 10,
    roundDurationMs: 10_000,
    resultsDurationMs: 2_000,
    capitals: CAPITALS,
  });
}

describe("Capital Pin engine", () => {
  it("starts in the lobby with no participants", () => {
    const engine = createEngine();
    expect(engine.phase).toBe("lobby");
    expect(engine.participantIds).toEqual([]);
    expect(engine.roundEndsAt).toBe(0);
  });

  it("starts a game with unique capitals and an active first round", () => {
    const engine = createEngine();
    engine.start(["a", "b"], () => "name");
    expect(engine.phase).toBe("round");
    expect(engine.participantIds).toEqual(["a", "b"]);
    expect(engine.totalRounds).toBe(10);
    expect(engine.currentRound?.roundNumber).toBe(1);
    expect(engine.roundEndsAt).toBe(11_000);
    expect(engine.currentRound?.capital.city).not.toBe("");
  });

  it("accepts one guess per participant per round", () => {
    const engine = createEngine();
    engine.start(["a", "b"], () => "name");
    expect(engine.submit("a", 1, 48.85, 2.35)).toBeNull();
    expect(engine.submit("a", 1, 0, 0)).toBe("INVALID_GAME_COMMAND");
    expect(engine.submit("b", 1, 40, 0)).toBeNull();
    expect(engine.submit("c", 1, 0, 0)).toBe("PLAYER_NOT_IN_ROOM");
    expect(engine.submit("a", 2, 0, 0)).toBe("GAME_NOT_RUNNING");
  });

  it("rejects submits outside a round or after the deadline", () => {
    const engine = createEngine();
    expect(engine.submit("a", 1, 0, 0)).toBe("GAME_NOT_RUNNING");
    let now = 1_000;
    const late = createEngine(() => now);
    late.start(["a", "b"], () => "name");
    now = 120_000;
    expect(late.submit("a", 1, 0, 0)).toBe("GAME_NOT_RUNNING");
  });

  it("ends a round early only when every connected participant submitted", () => {
    const engine = createEngine();
    engine.start(["a", "b"], () => "name");
    expect(engine.allConnectedParticipantsSubmitted(new Set(["a", "b"]))).toBe(false);
    engine.submit("a", 1, 48.85, 2.35);
    expect(engine.allConnectedParticipantsSubmitted(new Set(["a", "b"]))).toBe(false);
    expect(engine.allConnectedParticipantsSubmitted(new Set(["a"]))).toBe(true);
    engine.submit("b", 1, 40, 0);
    expect(engine.allConnectedParticipantsSubmitted(new Set(["a", "b"]))).toBe(true);
  });

  it("computes results and scores, then advances through all rounds to finished", () => {
    const engine = createEngine();
    engine.start(["a", "b"], (id) => (id === "a" ? "Alice" : "Bob"));

    for (let round = 1; round <= 10; round++) {
      expect(engine.phase).toBe("round");
      expect(engine.currentRound?.roundNumber).toBe(round);
      engine.submit("a", round, 48.85, 2.35);
      engine.submit("b", round, 40, 0);
      engine.endRound();
      expect(engine.phase).toBe("round-results");
      expect(engine.lastResult?.roundNumber).toBe(round);
      expect(engine.lastResult?.winnerSessionIds.length).toBeGreaterThan(0);
      engine.advanceFromResults();
    }

    expect(engine.phase).toBe("finished");
    expect(engine.result?.leaderboard).toHaveLength(2);
    expect(engine.result?.winnerSessionIds.length).toBeGreaterThan(0);
  });

  it("removes a departing player's guess and score", () => {
    const engine = createEngine();
    engine.start(["a", "b"], () => "name");
    engine.submit("a", 1, 48.85, 2.35);
    engine.onPlayerRemoved("a");
    expect(engine.participantIds).toEqual(["b"]);
    expect(engine.currentRound?.guesses.has("a")).toBe(false);
    expect(engine.scores.has("a")).toBe(false);
  });

  it("resets back to the lobby", () => {
    const engine = createEngine();
    engine.start(["a", "b"], () => "name");
    engine.submit("a", 1, 48.85, 2.35);
    engine.endRound();
    engine.reset();
    expect(engine.phase).toBe("lobby");
    expect(engine.participantIds).toEqual([]);
    expect(engine.lastResult).toBeNull();
    expect(engine.result).toBeNull();
    expect(engine.scores.size).toBe(0);
  });
});
