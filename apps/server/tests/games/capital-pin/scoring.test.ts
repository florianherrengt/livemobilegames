import { describe, expect, it } from "vitest";

import { CAPITAL_PIN_CONSTANTS } from "../../../src/games/capital-pin/constants.js";
import {
  applyRoundResultToScores,
  buildMatchResult,
  buildRoundResult,
  computeFinalWinners,
  computeRoundStandings,
} from "../../../src/games/capital-pin/scoring.js";
import { type Capital, emptyScore } from "../../../src/games/capital-pin/types.js";

const paris: Capital = {
  id: "par",
  city: "Paris",
  country: "France",
  latitude: 48.8566,
  longitude: 2.3522,
};

describe("round standings", () => {
  it("penalises missing guesses and picks the closest valid guess as winner", () => {
    const guesses = new Map([
      ["a", { sessionId: "a", latitude: 48.85, longitude: 2.35, submittedAt: 1 }],
      ["b", { sessionId: "b", latitude: 40, longitude: 0, submittedAt: 1 }],
    ]);
    const { standings, winnerSessionIds } = computeRoundStandings(paris, ["a", "b", "c"], guesses);
    expect(winnerSessionIds).toEqual(["a"]);
    const missing = standings.find((s) => s.sessionId === "c");
    expect(missing?.distanceKm).toBe(CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM);
    expect(missing?.validGuess).toBe(false);
  });

  it("ties winners within the distance epsilon", () => {
    const guesses = new Map([
      ["a", { sessionId: "a", latitude: 48.8566, longitude: 2.3522, submittedAt: 1 }],
      ["b", { sessionId: "b", latitude: 48.8566, longitude: 2.35221, submittedAt: 1 }],
    ]);
    const { winnerSessionIds } = computeRoundStandings(paris, ["a", "b"], guesses);
    expect(winnerSessionIds).toEqual(["a", "b"]);
  });

  it("returns no winners when nobody submitted", () => {
    const { winnerSessionIds, standings } = computeRoundStandings(paris, ["a", "b"], new Map());
    expect(winnerSessionIds).toEqual([]);
    expect(standings.every((s) => !s.validGuess)).toBe(true);
  });
});

describe("scores", () => {
  it("applies round results to the scoreboard", () => {
    const scores = new Map([
      ["a", emptyScore()],
      ["b", emptyScore()],
    ]);
    const guesses = new Map([
      ["a", { sessionId: "a", latitude: 48.85, longitude: 2.35, submittedAt: 1 }],
    ]);
    const result = buildRoundResult(["a", "b"], paris, 1, guesses, () => "name");
    applyRoundResultToScores(scores, result);
    expect(scores.get("a")?.roundWins).toBe(1);
    expect(scores.get("a")?.validGuessCount).toBe(1);
    expect(scores.get("b")?.roundWins).toBe(0);
    expect(scores.get("b")?.missedRoundCount).toBe(1);
    expect(scores.get("b")?.totalDistanceKm).toBe(CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM);
  });
});

describe("final winners and leaderboard", () => {
  it("ranks by wins then distance and orders by name", () => {
    const scores = new Map([
      ["a", { roundWins: 3, totalDistanceKm: 100, validGuessCount: 10, missedRoundCount: 0 }],
      ["b", { roundWins: 3, totalDistanceKm: 200, validGuessCount: 10, missedRoundCount: 0 }],
      ["c", { roundWins: 2, totalDistanceKm: 50, validGuessCount: 10, missedRoundCount: 0 }],
    ]);
    const result = buildMatchResult(
      ["a", "b", "c"],
      scores,
      (id) => ({ a: "Alice", b: "Bob", c: "Carol" })[id] ?? id,
      123,
    );
    expect(result.leaderboard.map((e) => e.sessionId)).toEqual(["a", "b", "c"]);
    expect(result.leaderboard[0]?.rank).toBe(1);
    // Standard competition ranking: equal round wins share a rank.
    expect(result.leaderboard[1]?.rank).toBe(1);
    expect(result.leaderboard[2]?.rank).toBe(3);
    expect(result.winnerSessionIds).toEqual(["a"]);
    expect(result.finishedAt).toBe(123);
  });

  it("makes equal-win-count players joint winners within the distance epsilon", () => {
    const scores = new Map([
      ["a", { roundWins: 4, totalDistanceKm: 10, validGuessCount: 10, missedRoundCount: 0 }],
      ["b", { roundWins: 4, totalDistanceKm: 10.0005, validGuessCount: 10, missedRoundCount: 0 }],
    ]);
    expect(computeFinalWinners(["a", "b"], scores, () => "x")).toEqual(["a", "b"]);
  });
});
