import { describe, expect, it } from "vitest";

import { type RoundResolution, resolveRound } from "../../../src/games/flappy-race/resolution.js";
import type { RoundProgressCandidate } from "../../../src/games/flappy-race/types.js";

function resolvedWinners(resolution: RoundResolution): string[] {
  if (resolution.outcome !== "resolved") {
    throw new Error("Expected a resolved round");
  }
  return resolution.winnerSessionIds;
}

function candidate(
  sessionId: string,
  cleared: number,
  roundActive: boolean,
  eligible = true,
): RoundProgressCandidate {
  return { sessionId, clearedObstacleCount: cleared, roundActive, eligible };
}

describe("round resolution", () => {
  it("awards the furthest player when one player crashes earlier", () => {
    const resolution = resolveRound([candidate("a", 11, false), candidate("b", 12, true)]);
    expect(resolution).toEqual({
      outcome: "resolved",
      winnerSessionIds: ["b"],
      reason: "survivor-proved",
    });
  });

  it("draws two players crashing on the same obstacle", () => {
    const resolution = resolveRound([candidate("a", 7, false), candidate("b", 7, false)]);
    expect(resolution).toEqual({
      outcome: "resolved",
      winnerSessionIds: ["a", "b"],
      reason: "all-eliminated",
    });
  });

  it("draws three or more players crashing on the same obstacle", () => {
    const resolution = resolveRound([
      candidate("a", 9, false),
      candidate("b", 9, false),
      candidate("c", 9, false),
    ]);
    expect(resolvedWinners(resolution).sort()).toEqual(["a", "b", "c"]);
    expect(resolution).toMatchObject({ outcome: "resolved", reason: "all-eliminated" });
  });

  it("excludes players eliminated on earlier obstacles from a later draw", () => {
    const resolution = resolveRound([
      candidate("a", 11, false),
      candidate("b", 11, false),
      candidate("c", 11, false),
      candidate("d", 12, false),
    ]);
    expect(resolvedWinners(resolution)).toEqual(["d"]);
  });

  it("requires a sole survivor to exceed the highest eliminated progress", () => {
    expect(resolveRound([candidate("a", 11, false), candidate("b", 11, true)])).toEqual({
      outcome: "continue",
    });
  });

  it("wins immediately when a sole survivor passes one additional obstacle", () => {
    const resolution = resolveRound([candidate("a", 11, false), candidate("b", 12, true)]);
    expect(resolvedWinners(resolution)).toEqual(["b"]);
  });

  it("is independent of candidate ordering and elimination timing", () => {
    const first = [candidate("a", 11, false), candidate("b", 11, true), candidate("c", 12, false)];
    const second = [candidate("c", 12, false), candidate("b", 11, true), candidate("a", 11, false)];
    expect(resolveRound(first)).toEqual(resolveRound(second));
  });

  it("keeps winner lists unique", () => {
    const resolution = resolveRound([
      candidate("a", 5, false),
      candidate("b", 5, false),
      candidate("c", 5, false),
      candidate("d", 4, false),
    ]);
    const winners = resolvedWinners(resolution);
    expect(new Set(winners).size).toBe(winners.length);
    expect(winners).toContain("a");
    expect(winners).not.toContain("d");
  });

  it("never includes a disconnected player as a winner", () => {
    const resolution = resolveRound([candidate("a", 99, false, false), candidate("b", 2, false)]);
    expect(resolvedWinners(resolution)).toEqual(["b"]);
  });

  it("resolves a sole remaining eligible player in their favour", () => {
    const resolution = resolveRound([candidate("a", 0, true), candidate("b", 50, false, false)]);
    expect(resolution).toEqual({
      outcome: "resolved",
      winnerSessionIds: ["a"],
      reason: "sole-eligible",
    });
  });

  it("resolves with no winners when nobody is eligible", () => {
    expect(
      resolveRound([candidate("a", 10, true, false), candidate("b", 20, true, false)]),
    ).toEqual({ outcome: "resolved", winnerSessionIds: [], reason: "no-eligible" });
  });

  it("keeps a multi-player round going while everyone is alive", () => {
    expect(
      resolveRound([candidate("a", 0, true), candidate("b", 0, true), candidate("c", 0, true)]),
    ).toEqual({ outcome: "continue" });
  });
});
