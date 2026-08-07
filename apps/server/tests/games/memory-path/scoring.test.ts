import { describe, expect, it } from "vitest";
import {
  createRuntime,
  createRuntimePlayer,
  createSettings,
} from "../../../src/games/memory-path/runtime.js";
import {
  buildMatchResult,
  compareTimeoutCandidates,
  matchLeaders,
  resolveTimeoutWinner,
  type TimeoutCandidate,
} from "../../../src/games/memory-path/scoring.js";

function candidate(
  sessionId: string,
  options: {
    connected?: boolean;
    participating?: boolean;
    maxProgress?: number;
    firstReachedAt?: number;
    falls?: number;
    joinedOrder?: number;
  } = {},
): TimeoutCandidate {
  return {
    sessionId,
    connected: options.connected ?? true,
    participating: options.participating ?? true,
    maxProgress: options.maxProgress ?? 0,
    maxProgressFirstReachedAt: options.firstReachedAt ?? 0,
    falls: options.falls ?? 0,
    joinedOrder: options.joinedOrder ?? 0,
  };
}

describe("Memory Path timeout ranking", () => {
  it("ranks by highest maximum valid progress first", () => {
    const first = candidate("a", { maxProgress: 0.9, joinedOrder: 1 });
    const second = candidate("b", { maxProgress: 0.8, joinedOrder: 0 });
    expect(compareTimeoutCandidates(first, second)).toBeLessThan(0);
  });

  it("uses the earlier first-reached time when progress is tied", () => {
    const earlier = candidate("a", { maxProgress: 0.5, firstReachedAt: 2_000 });
    const later = candidate("b", { maxProgress: 0.5, firstReachedAt: 4_000 });
    expect(compareTimeoutCandidates(earlier, later)).toBeLessThan(0);
  });

  it("uses fewer falls as the next tie-break", () => {
    const fewerFalls = candidate("a", {
      maxProgress: 0.5,
      firstReachedAt: 4_000,
      falls: 1,
    });
    const moreFalls = candidate("b", {
      maxProgress: 0.5,
      firstReachedAt: 4_000,
      falls: 2,
    });
    expect(compareTimeoutCandidates(fewerFalls, moreFalls)).toBeLessThan(0);
  });

  it("resolves exact ties deterministically by joined order", () => {
    const alice = candidate("alice", { joinedOrder: 0 });
    const bob = candidate("bob", { joinedOrder: 1 });
    expect(compareTimeoutCandidates(alice, bob)).toBeLessThan(0);
    expect(compareTimeoutCandidates(bob, alice)).toBeGreaterThan(0);
  });

  it("excludes disconnected and non-participating players from timeout winners", () => {
    const runtime = createRuntime(createSettings(true));
    runtime.players.set("alice", createRuntimePlayer("alice", "Alice", 0, "#0072B2"));
    runtime.players.set("bob", createRuntimePlayer("bob", "Bob", 1, "#E69F00"));
    const alice = runtime.players.get("alice");
    const bob = runtime.players.get("bob");
    if (!alice || !bob) {
      throw new Error("players missing");
    }
    alice.connected = false;
    alice.maxProgress = 0.99;
    bob.participating = true;
    bob.maxProgress = 0.2;
    expect(resolveTimeoutWinner([...runtime.players.values()])).toBe("bob");
  });
});

describe("Memory Path match result", () => {
  it("ranks by round wins with competition ranking and a single winner", () => {
    const runtime = createRuntime(createSettings(true));
    const alice = createRuntimePlayer("alice", "Alice", 0, "#0072B2");
    const bob = createRuntimePlayer("bob", "Bob", 1, "#E69F00");
    alice.roundWins = 3;
    bob.roundWins = 1;
    runtime.players.set("alice", alice);
    runtime.players.set("bob", bob);
    runtime.roundResults = [
      {
        roundNumber: 1,
        winnerSessionIds: ["alice"],
        winnerLabel: "Alice",
        reason: "finish",
        winnerProgress: 100,
        suddenDeath: false,
      },
      {
        roundNumber: 2,
        winnerSessionIds: ["alice"],
        winnerLabel: "Alice",
        reason: "timeout",
        winnerProgress: 42,
        suddenDeath: false,
      },
      {
        roundNumber: 3,
        winnerSessionIds: ["alice"],
        winnerLabel: "Alice",
        reason: "timeout",
        winnerProgress: 18,
        suddenDeath: false,
      },
    ];
    const result = buildMatchResult(runtime);
    expect(result?.winnerSessionIds).toEqual(["alice"]);
    expect(result?.leaderboard.map((entry) => [entry.label, entry.rank])).toEqual([
      ["Alice", 1],
      ["Bob", 2],
    ]);
  });

  it("finds every connected leader for sudden death", () => {
    const runtime = createRuntime(createSettings(true));
    const alice = createRuntimePlayer("alice", "Alice", 0, "#0072B2");
    const bob = createRuntimePlayer("bob", "Bob", 1, "#E69F00");
    const carol = createRuntimePlayer("carol", "Carol", 2, "#009E73");
    alice.roundWins = 2;
    bob.roundWins = 2;
    carol.roundWins = 0;
    runtime.players.set("alice", alice);
    runtime.players.set("bob", bob);
    runtime.players.set("carol", carol);
    expect(
      matchLeaders(runtime)
        .map((player) => player.sessionId)
        .sort(),
    ).toEqual(["alice", "bob"]);
  });

  it("keeps a departed round winner's display name in the final results", () => {
    const runtime = createRuntime(createSettings(true));
    runtime.players.set("bob", createRuntimePlayer("bob", "Bob", 1, "#E69F00"));
    runtime.roundResults = [
      {
        roundNumber: 1,
        winnerSessionIds: ["alice"],
        winnerLabel: "Alice",
        reason: "finish",
        winnerProgress: 100,
        suddenDeath: false,
      },
    ];
    const result = buildMatchResult(runtime);
    expect(result?.roundResults[0]?.winnerLabel).toBe("Alice");
  });
});
