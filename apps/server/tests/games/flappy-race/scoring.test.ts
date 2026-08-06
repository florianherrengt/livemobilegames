import { describe, expect, it } from "vitest";

import { buildFlappyRaceResult } from "../../../src/games/flappy-race/scoring.js";
import type { FlappyRaceRuntime } from "../../../src/games/flappy-race/types.js";

function makeRuntime(scores: Array<{ sessionId: string; name: string; roundWins: number }>) {
  const players = new Map(
    scores.map((score, index) => [
      score.sessionId,
      {
        sessionId: score.sessionId,
        name: score.name,
        connected: true,
        eligible: true,
        roundActive: false,
        eliminated: false,
        birdY: 0,
        birdVy: 0,
        clearedObstacleCount: 0,
        nextObstacleIndex: 0,
        flapQueued: false,
        lastFlapSequence: 0,
        seenFlapSequences: new Set<number>(),
        roundWins: score.roundWins,
        roundWonThisRound: false,
        color: "",
        joinedOrder: index,
      },
    ]),
  );
  return { players } as unknown as FlappyRaceRuntime;
}

describe("match result", () => {
  it("ranks by round wins with competition ranking", () => {
    const result = buildFlappyRaceResult(
      makeRuntime([
        { sessionId: "a", name: "Alice", roundWins: 5 },
        { sessionId: "b", name: "Bob", roundWins: 4 },
        { sessionId: "c", name: "Carol", roundWins: 4 },
      ]),
    );
    expect(result.winnerSessionIds).toEqual(["a"]);
    expect(result.leaderboard.map((entry) => [entry.label, entry.rank])).toEqual([
      ["Alice", 1],
      ["Bob", 2],
      ["Carol", 2],
    ]);
  });

  it("keeps tied winners together", () => {
    const result = buildFlappyRaceResult(
      makeRuntime([
        { sessionId: "a", name: "Alice", roundWins: 4 },
        { sessionId: "b", name: "Bob", roundWins: 4 },
      ]),
    );
    expect(result.winnerSessionIds.sort()).toEqual(["a", "b"]);
    expect(result.leaderboard.every((entry) => entry.rank === 1)).toBe(true);
  });
});
