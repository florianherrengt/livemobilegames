import { describe, expect, it } from "vitest";
import { CAPITAL_PIN_CONSTANTS } from "../src/constants.js";
import {
  applyRoundResultToScores,
  buildRoundResult,
  computeFinalWinners,
  computeRoundStandings,
} from "../src/scoring.js";
import type { Capital, Guess, Score } from "../src/types.js";

const PARIS: Capital = {
  id: "par",
  city: "Paris",
  country: "France",
  latitude: 48.8566,
  longitude: 2.3522,
};

function guess(sessionId: string, lat: number, lng: number): Guess {
  return { sessionId, latitude: lat, longitude: lng, submittedAt: 0 };
}

function scoresFor(ids: string[], overrides?: Map<string, Score>): Map<string, Score> {
  return (
    overrides ??
    new Map(
      ids.map((id) => [
        id,
        { roundWins: 0, totalDistanceKm: 0, validGuessCount: 0, missedRoundCount: 0 },
      ]),
    )
  );
}

describe("computeRoundStandings", () => {
  it("the closest player wins", () => {
    const guesses = new Map([
      ["alice", guess("alice", 49.0, 2.4)], // near Paris
      ["bob", guess("bob", 40.0, 0.0)], // far (Spain-ish)
    ]);
    const { winnerSessionIds, standings } = computeRoundStandings(PARIS, ["alice", "bob"], guesses);
    expect(winnerSessionIds).toEqual(["alice"]);
    const alice = standings.find((s) => s.sessionId === "alice");
    if (!alice) {
      throw new Error("missing alice standing");
    }
    expect(alice.distanceKm).toBeLessThan(150);
    expect(alice.isWinner).toBe(true);
  });

  it("a single valid guess wins", () => {
    const guesses = new Map([["alice", guess("alice", 49.0, 2.4)]]);
    const { winnerSessionIds } = computeRoundStandings(PARIS, ["alice", "bob"], guesses);
    expect(winnerSessionIds).toEqual(["alice"]);
  });

  it("produces no winner when no valid guesses exist", () => {
    const guesses = new Map();
    const { winnerSessionIds, standings } = computeRoundStandings(PARIS, ["alice", "bob"], guesses);
    expect(winnerSessionIds).toEqual([]);
    for (const s of standings) {
      expect(s.validGuess).toBe(false);
      expect(s.distanceKm).toBe(CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM);
    }
  });

  it("applies the missing-guess penalty to players without a guess", () => {
    const guesses = new Map([["alice", guess("alice", 48.85, 2.35)]]);
    const { standings } = computeRoundStandings(PARIS, ["alice", "bob"], guesses);
    const bob = standings.find((s) => s.sessionId === "bob");
    if (!bob) {
      throw new Error("missing bob standing");
    }
    expect(bob.validGuess).toBe(false);
    expect(bob.distanceKm).toBe(CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM);
  });

  it("keeps distances unrounded internally", () => {
    const guesses = new Map([["alice", guess("alice", 49.0, 2.4)]]);
    const { standings } = computeRoundStandings(PARIS, ["alice"], guesses);
    const alice = standings.find((s) => s.sessionId === "alice");
    if (!alice) {
      throw new Error("missing alice standing");
    }
    expect(alice.distanceKm).not.toEqual(Math.round(alice.distanceKm));
  });

  it("treats players within one metre as tied winners", () => {
    const guesses = new Map([
      ["alice", guess("alice", 48.8566, 2.3522)], // exactly on Paris -> 0 km
      ["bob", guess("bob", 48.8566, 2.352205)], // ~0.0004 km away (well within 1 m)
    ]);
    const { winnerSessionIds } = computeRoundStandings(PARIS, ["alice", "bob"], guesses);
    expect(new Set(winnerSessionIds)).toEqual(new Set(["alice", "bob"]));
  });

  it("does not tie players more than one metre apart", () => {
    const guesses = new Map([
      ["alice", guess("alice", 48.8566, 2.3522)], // ~0 km
      ["bob", guess("bob", 48.86, 2.37)], // several hundred metres away
    ]);
    const { winnerSessionIds, standings } = computeRoundStandings(PARIS, ["alice", "bob"], guesses);
    expect(winnerSessionIds).toEqual(["alice"]);
    const bob = standings.find((s) => s.sessionId === "bob");
    if (!bob) {
      throw new Error("missing bob standing");
    }
    expect(bob.isWinner).toBe(false);
  });
});

describe("buildRoundResult + applyRoundResultToScores", () => {
  it("accumulates wins, distance and misses across rounds", () => {
    const scores = scoresFor(["alice", "bob"]);

    // Round 1: Alice wins, Bob misses.
    const r1 = buildRoundResult(
      ["alice", "bob"],
      PARIS,
      1,
      new Map([["alice", guess("alice", 48.86, 2.35)]]),
    );
    applyRoundResultToScores(scores, r1);

    const aliceScore = scores.get("alice");
    const bobScore = scores.get("bob");
    if (!aliceScore || !bobScore) {
      throw new Error("missing scores");
    }
    expect(aliceScore.roundWins).toBe(1);
    expect(bobScore.roundWins).toBe(0);
    expect(bobScore.missedRoundCount).toBe(1);
    expect(bobScore.totalDistanceKm).toBe(CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM);

    // Round 2: both guess, Bob closer.
    const r2 = buildRoundResult(
      ["alice", "bob"],
      PARIS,
      2,
      new Map([
        ["alice", guess("alice", 50.0, 5.0)],
        ["bob", guess("bob", 48.86, 2.3522)],
      ]),
    );
    applyRoundResultToScores(scores, r2);

    const aliceScoreAfter = scores.get("alice");
    const bobScoreAfter = scores.get("bob");
    if (!aliceScoreAfter || !bobScoreAfter) {
      throw new Error("missing scores");
    }
    expect(aliceScoreAfter.roundWins).toBe(1);
    expect(bobScoreAfter.roundWins).toBe(1);
    expect(bobScoreAfter.validGuessCount).toBe(1);
  });
});

describe("computeFinalWinners", () => {
  const names = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

  it("the player with the most round wins wins", () => {
    const scores = scoresFor(
      ["alice", "bob"],
      new Map([
        [
          "alice",
          { roundWins: 5, totalDistanceKm: 10_000, validGuessCount: 5, missedRoundCount: 0 },
        ],
        ["bob", { roundWins: 4, totalDistanceKm: 2_000, validGuessCount: 4, missedRoundCount: 0 }],
      ]),
    );
    expect(computeFinalWinners(["alice", "bob"], scores, names)).toEqual(["alice"]);
  });

  it("total distance breaks equal round wins", () => {
    const scores = scoresFor(
      ["alice", "bob"],
      new Map([
        [
          "alice",
          { roundWins: 4, totalDistanceKm: 8_000, validGuessCount: 4, missedRoundCount: 0 },
        ],
        ["bob", { roundWins: 4, totalDistanceKm: 7_000, validGuessCount: 4, missedRoundCount: 0 }],
      ]),
    );
    expect(computeFinalWinners(["alice", "bob"], scores, names)).toEqual(["bob"]);
  });

  it("players within one metre of the top distance are joint winners", () => {
    const scores = scoresFor(
      ["alice", "bob"],
      new Map([
        [
          "alice",
          { roundWins: 4, totalDistanceKm: 7_000.0, validGuessCount: 4, missedRoundCount: 0 },
        ],
        [
          "bob",
          { roundWins: 4, totalDistanceKm: 7_000.0005, validGuessCount: 4, missedRoundCount: 0 },
        ],
      ]),
    );
    expect(new Set(computeFinalWinners(["alice", "bob"], scores, names))).toEqual(
      new Set(["alice", "bob"]),
    );
  });

  it("missing-round penalty affects the tie-break (more misses => higher distance)", () => {
    const scores = scoresFor(
      ["alice", "bob"],
      new Map([
        [
          "alice",
          {
            roundWins: 4,
            totalDistanceKm: 4_000 + CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM,
            validGuessCount: 4,
            missedRoundCount: 1,
          },
        ],
        ["bob", { roundWins: 4, totalDistanceKm: 4_000, validGuessCount: 5, missedRoundCount: 0 }],
      ]),
    );
    expect(computeFinalWinners(["alice", "bob"], scores, names)).toEqual(["bob"]);
  });

  it("returns an empty list when there are no participants", () => {
    expect(computeFinalWinners([], new Map(), names)).toEqual([]);
  });
});
