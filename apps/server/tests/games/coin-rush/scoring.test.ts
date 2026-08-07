import { describe, expect, it } from "vitest";

import { buildResult, resolveThreshold } from "../../../src/games/coin-rush/scoring.js";
import { addPlayerAt, makeRuntime } from "./helpers.js";

describe("Coin Rush threshold resolution", () => {
  it("picks the highest resulting score when several players cross 10", () => {
    const runtime = makeRuntime();
    const alice = addPlayerAt(runtime, "a", "Alice", 1, 1);
    const bob = addPlayerAt(runtime, "b", "Bob", 2, 2);
    alice.score = 11;
    bob.score = 12;
    const result = resolveThreshold(runtime, [alice, bob]);
    expect(result.suddenDeath).toBe(false);
    expect(result.winners.map((player) => player.sessionId)).toEqual(["b"]);
  });

  it("breaks an equal threshold tie by fewer current-round deaths, not match deaths", () => {
    const runtime = makeRuntime();
    const alice = addPlayerAt(runtime, "a", "Alice", 1, 1);
    const bob = addPlayerAt(runtime, "b", "Bob", 2, 2);
    alice.score = 12;
    bob.score = 12;
    alice.roundDeaths = 1;
    bob.roundDeaths = 2;
    // Match-level totals must not decide a simultaneous threshold tie.
    alice.deaths = 9;
    bob.deaths = 0;
    const result = resolveThreshold(runtime, [alice, bob]);
    expect(result.suddenDeath).toBe(false);
    expect(result.winners.map((player) => player.sessionId)).toEqual(["a"]);
  });

  it("enters sudden death when score and deaths are exactly tied", () => {
    const runtime = makeRuntime();
    const alice = addPlayerAt(runtime, "a", "Alice", 1, 1);
    const bob = addPlayerAt(runtime, "b", "Bob", 2, 2);
    alice.score = 12;
    bob.score = 12;
    const result = resolveThreshold(runtime, [alice, bob]);
    expect(result.suddenDeath).toBe(true);
    expect(result.winners).toHaveLength(2);
  });
});

describe("Coin Rush match result", () => {
  it("ranks by round wins, then total coins, then fewer deaths", () => {
    const runtime = makeRuntime();
    const alice = addPlayerAt(runtime, "a", "Alice", 1, 1);
    const bob = addPlayerAt(runtime, "b", "Bob", 2, 2);
    const carol = addPlayerAt(runtime, "c", "Carol", 3, 3);
    alice.roundWins = 2;
    bob.roundWins = 1;
    carol.roundWins = 1;
    bob.totalCoins = 8;
    carol.totalCoins = 7;
    const result = buildResult(runtime);
    expect(result.winnerSessionIds).toEqual(["a"]);
    expect(result.leaderboard.map((entry) => entry.sessionId)).toEqual(["a", "b", "c"]);
    expect(result.leaderboard[1]?.rank).toBe(2);
    expect(result.leaderboard[2]?.rank).toBe(3);
  });

  it("shares the match victory when all tiebreakers are equal", () => {
    const runtime = makeRuntime();
    const alice = addPlayerAt(runtime, "a", "Alice", 1, 1);
    const bob = addPlayerAt(runtime, "b", "Bob", 2, 2);
    alice.roundWins = 1;
    bob.roundWins = 1;
    alice.totalCoins = 5;
    bob.totalCoins = 5;
    alice.deaths = 1;
    bob.deaths = 1;
    const result = buildResult(runtime);
    expect(result.winnerSessionIds.sort()).toEqual(["a", "b"]);
    expect(result.leaderboard.every((entry) => entry.rank === 1)).toBe(true);
  });
});
