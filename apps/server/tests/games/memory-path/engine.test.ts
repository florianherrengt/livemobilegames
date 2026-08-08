import { MEMORY_PATH_CONSTANTS } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import { updateRuntime } from "../../../src/games/memory-path/engine.js";
import { ROUTES_BY_DIFFICULTY } from "../../../src/games/memory-path/paths.js";
import {
  createRuntime,
  createRuntimePlayer,
  createSettings,
  startMatch,
} from "../../../src/games/memory-path/runtime.js";
import type { MemoryPathRuntime, RuntimePlayer } from "../../../src/games/memory-path/types.js";

const VERTICAL_ROUTE = {
  id: "test-vertical",
  difficulty: "easy" as const,
  points: [
    { x: 195, y: 700 },
    { x: 195, y: 420 },
    { x: 195, y: 140 },
  ],
};

function makeRuntime(e2eMode = true): MemoryPathRuntime {
  const runtime = createRuntime(createSettings(e2eMode));
  runtime.players.set("alice", createRuntimePlayer("alice", "Alice", 0, "#0072B2"));
  runtime.players.set("bob", createRuntimePlayer("bob", "Bob", 1, "#E69F00"));
  expect(startMatch(runtime, 0)).toBe(true);
  runtime.route = VERTICAL_ROUTE;
  runtime.pathWidth = MEMORY_PATH_CONSTANTS.EASY_PATH_WIDTH;
  return runtime;
}

function runUntil(
  runtime: MemoryPathRuntime,
  predicate: (runtime: MemoryPathRuntime) => boolean,
  maxMs = 60_000,
): void {
  for (let now = 0; now <= maxMs; now += 50) {
    updateRuntime(runtime, now);
    if (predicate(runtime)) {
      return;
    }
  }
  throw new Error("Simulation did not reach the expected state");
}

function advanceTo(runtime: MemoryPathRuntime, targetMs: number): void {
  let now = runtime.lastTickAt;
  while (now <= targetMs) {
    updateRuntime(runtime, now);
    now += 50;
  }
}

function runToPhase(runtime: MemoryPathRuntime, phase: MemoryPathRuntime["phase"]): void {
  runUntil(runtime, (current) => current.phase === phase);
}

function beginRace(runtime: MemoryPathRuntime): void {
  runToPhase(runtime, "racing");
}

function player(runtime: MemoryPathRuntime, sessionId: string): RuntimePlayer {
  const value = runtime.players.get(sessionId);
  if (!value) {
    throw new Error(`Player ${sessionId} missing`);
  }
  return value;
}

describe("Memory Path round timing", () => {
  it("runs a five-second preview, locks movement, then starts the thirty-second race", () => {
    const runtime = makeRuntime(false);
    const alice = player(runtime, "alice");

    runUntil(runtime, (current) => current.phase === "preview", 5_000);
    expect(runtime.previewEndsAt - 1_200).toBe(5_000);
    alice.inputX = 1;
    alice.inputY = 0;
    advanceTo(runtime, runtime.previewEndsAt - 50);
    expect(alice.position.x).toBe(MEMORY_PATH_CONSTANTS.START_X);
    expect(runtime.phase).toBe("preview");

    advanceTo(runtime, runtime.previewEndsAt);
    expect(runtime.phase).toBe("racing");
    expect(runtime.raceEndsAt - runtime.raceStartedAt).toBe(30_000);
    expect(runtime.pathVisible).toBe(false);
  });

  it("flashes the path every five seconds for 0.75 seconds only after the race starts", () => {
    const runtime = makeRuntime(false);
    beginRace(runtime);

    expect(runtime.pathVisible).toBe(false);
    advanceTo(runtime, runtime.raceStartedAt + 4_950);
    expect(runtime.pathVisible).toBe(false);
    advanceTo(runtime, runtime.raceStartedAt + 5_000);
    expect(runtime.pathVisible).toBe(true);
    expect(runtime.opponentsVisible).toBe(true);
    advanceTo(runtime, runtime.raceStartedAt + 5_750);
    expect(runtime.pathVisible).toBe(false);
    advanceTo(runtime, runtime.raceStartedAt + 10_000);
    expect(runtime.pathVisible).toBe(true);
  });

  it("does not reset the timer or flash schedule when a player falls", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    alice.inputX = 1;
    alice.inputY = 0;
    advanceTo(runtime, runtime.raceStartedAt + 250);
    expect(alice.falling).toBe(true);
    const elapsedAfterFall = runtime.raceElapsedMs;
    const respawnEndsAt = alice.respawnEndsAt;
    advanceTo(runtime, respawnEndsAt);
    expect(alice.falling).toBe(false);
    expect(runtime.raceElapsedMs).toBeGreaterThan(elapsedAfterFall);
    expect(runtime.players.get("alice")?.position.y).toBe(MEMORY_PATH_CONSTANTS.START_Y);
  });

  it("keeps a scheduled flash active when a player falls exactly at the flash boundary", () => {
    const runtime = makeRuntime(false);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    advanceTo(runtime, runtime.raceStartedAt + 4_950);
    alice.position = { x: 350, y: 600 };
    advanceTo(runtime, runtime.raceStartedAt + 5_000);
    expect(alice.falling).toBe(true);
    expect(runtime.pathVisible).toBe(true);
    expect(runtime.opponentsVisible).toBe(true);
    advanceTo(runtime, runtime.raceStartedAt + 5_750);
    expect(runtime.pathVisible).toBe(false);
  });

  it("resolves by timeout after thirty seconds when nobody finishes", () => {
    const runtime = makeRuntime(false);
    runUntil(runtime, (current) => current.phase === "round-result", 40_000);
    expect(runtime.roundResult?.reason).toBe("timeout");
    expect(runtime.roundResult?.winnerSessionIds).toEqual(["alice"]);
    expect(runtime.pathVisible).toBe(true);
    expect(runtime.opponentsVisible).toBe(true);
  });
});

describe("Memory Path movement, falls, and respawns", () => {
  it("moves a player along valid corridor input and records progress", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    alice.inputX = 0;
    alice.inputY = -1;
    advanceTo(runtime, runtime.raceStartedAt + 1_500);
    expect(alice.position.y).toBeLessThan(MEMORY_PATH_CONSTANTS.START_Y);
    expect(alice.progress).toBeGreaterThan(0.1);
    expect(alice.falling).toBe(false);
  });

  it("allows the small edge tolerance and falls only when the centre clearly leaves", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    alice.position = { x: 195 + MEMORY_PATH_CONSTANTS.EASY_PATH_WIDTH * 0.53, y: 600 };
    advanceTo(runtime, runtime.raceStartedAt + 50);
    expect(alice.falling).toBe(false);

    alice.position = {
      x: 195 + MEMORY_PATH_CONSTANTS.EASY_PATH_WIDTH,
      y: 600,
    };
    advanceTo(runtime, runtime.raceStartedAt + 100);
    expect(alice.falling).toBe(true);
    expect(alice.falls).toBe(1);
  });

  it("resets current progress but preserves maximum progress after a fall", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    alice.inputX = 0;
    alice.inputY = -1;
    advanceTo(runtime, runtime.raceStartedAt + 1_500);
    const maxBeforeFall = alice.maxProgress;
    expect(maxBeforeFall).toBeGreaterThan(0.2);
    alice.inputX = 1;
    alice.inputY = 0;
    advanceTo(runtime, runtime.raceStartedAt + 2_000);
    expect(alice.falling).toBe(true);
    expect(alice.progress).toBe(0);
    expect(alice.maxProgress).toBeGreaterThan(0.2);
    expect(alice.maxProgress).toBeGreaterThanOrEqual(maxBeforeFall);
  });

  it("finishes immediately when the first valid player reaches the finish", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    alice.inputX = 0;
    alice.inputY = -1;
    runUntil(runtime, (current) => current.phase === "round-result", 5_000);
    expect(runtime.roundResult?.reason).toBe("finish");
    expect(runtime.roundResult?.winnerSessionIds).toEqual(["alice"]);
    expect(player(runtime, "alice").finished).toBe(true);
    expect(player(runtime, "bob").roundActive).toBe(false);
  });

  it("resolves two simultaneous finish attempts deterministically", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    const bob = player(runtime, "bob");
    alice.position = { x: 195, y: 150 };
    bob.position = { x: 195, y: 152 };
    advanceTo(runtime, runtime.raceStartedAt + 50);
    expect(runtime.roundResult?.winnerSessionIds).toEqual(["alice"]);
  });

  it("prefers a valid finish over the timeout when both occur in the same update", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    advanceTo(runtime, runtime.raceStartedAt + runtime.settings.raceMs - 100);
    alice.position = { x: 195, y: 150 };
    advanceTo(runtime, runtime.raceStartedAt + runtime.settings.raceMs);
    expect(runtime.roundResult?.reason).toBe("finish");
  });

  it("credits a player who crosses the finish line and leaves the corridor in the same update", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const alice = player(runtime, "alice");
    alice.position = { x: 195, y: 160 };
    alice.inputY = -1;
    runtime.lastTickAt = runtime.raceStartedAt - 250;
    advanceTo(runtime, runtime.raceStartedAt + 250);
    expect(runtime.roundResult?.reason).toBe("finish");
    expect(player(runtime, "alice").finished).toBe(true);
  });
});

describe("Memory Path round and match flow", () => {
  it("runs three normal rounds then sudden death and produces one winner", () => {
    const runtime = makeRuntime(true);
    const carol = createRuntimePlayer("carol", "Carol", 2, "#009E73");
    runtime.players.set("carol", carol);
    player(runtime, "alice").roundWins = 1;
    player(runtime, "bob").roundWins = 1;
    carol.roundWins = 1;
    runtime.phase = "round-result";
    runtime.roundNumber = 3;
    runtime.resultsEndsAt = 0;
    runtime.suddenDeath = false;
    runtime.roundResults = [1, 2, 3].map((roundNumber) => ({
      roundNumber,
      winnerSessionIds: [roundNumber === 1 ? "alice" : roundNumber === 2 ? "bob" : "carol"],
      winnerLabel: roundNumber === 1 ? "Alice" : roundNumber === 2 ? "Bob" : "Carol",
      reason: "finish" as const,
      winnerProgress: 100,
      suddenDeath: false,
    }));
    updateRuntime(runtime, 10_000);
    expect(runtime.phase).toBe("preparing");
    runUntil(runtime, (current) => current.phase === "match-result", 90_000);
    expect(runtime.roundNumber).toBe(4);
    expect(runtime.suddenDeath).toBe(true);
    expect(runtime.totalRounds).toBe(4);
    expect(runtime.roundResults).toHaveLength(4);
    expect(runtime.result?.suddenDeathUsed).toBe(true);
    expect(runtime.result?.winnerSessionIds).toEqual(["alice"]);
    expect(
      runtime.result?.leaderboard.find((entry) => entry.sessionId === "alice")?.roundWins,
    ).toBe(2);
  });

  it("never reuses the same effective route within a match", () => {
    const runtime = createRuntime(createSettings(true));
    runtime.players.set("alice", createRuntimePlayer("alice", "Alice", 0, "#0072B2"));
    runtime.players.set("bob", createRuntimePlayer("bob", "Bob", 1, "#E69F00"));
    startMatch(runtime, 0);

    const seen = new Set<string>();
    let previousRouteId = "";
    for (let now = 0; now <= 90_000; now += 50) {
      updateRuntime(runtime, now);
      if (runtime.route.id !== previousRouteId && runtime.route.id !== "") {
        expect(seen.has(runtime.route.id)).toBe(false);
        seen.add(runtime.route.id);
        previousRouteId = runtime.route.id;
      }
      if (runtime.phase === "match-result") {
        break;
      }
    }
    expect(seen.size).toBe(3);
    expect(runtime.phase).toBe("match-result");
  });

  it("lets only tied leaders participate in sudden death", () => {
    const runtime = makeRuntime(true);
    const carol = createRuntimePlayer("carol", "Carol", 2, "#009E73");
    runtime.players.set("carol", carol);
    player(runtime, "alice").roundWins = 2;
    player(runtime, "bob").roundWins = 2;
    carol.roundWins = 0;
    runtime.phase = "round-result";
    runtime.roundNumber = 3;
    runtime.resultsEndsAt = 0;
    runtime.suddenDeath = false;

    updateRuntime(runtime, 10_000);
    expect(runtime.phase).toBe("preparing");
    expect(runtime.roundNumber).toBe(4);
    expect(runtime.suddenDeath).toBe(true);
    expect(player(runtime, "alice").participating).toBe(true);
    expect(player(runtime, "bob").participating).toBe(true);
    expect(player(runtime, "carol").participating).toBe(false);
  });

  it("keeps a briefly disconnected tied leader in sudden-death participation", () => {
    const runtime = makeRuntime(true);
    const carol = createRuntimePlayer("carol", "Carol", 2, "#009E73");
    runtime.players.set("carol", carol);
    carol.connected = false;
    carol.roundWins = 1;
    player(runtime, "alice").roundWins = 1;
    player(runtime, "bob").roundWins = 1;
    runtime.phase = "round-result";
    runtime.roundNumber = 3;
    runtime.resultsEndsAt = 0;
    runtime.suddenDeath = false;

    updateRuntime(runtime, 10_000);
    expect(runtime.phase).toBe("preparing");
    expect(runtime.suddenDeath).toBe(true);
    expect(player(runtime, "alice").participating).toBe(true);
    expect(player(runtime, "bob").participating).toBe(true);
    expect(player(runtime, "carol").participating).toBe(true);
    expect(player(runtime, "carol").roundActive).toBe(false);
  });

  it("waits for sudden death when one of two tied leaders is reconnecting", () => {
    const runtime = makeRuntime(true);
    player(runtime, "alice").roundWins = 1;
    const bob = player(runtime, "bob");
    bob.roundWins = 1;
    bob.connected = false;
    bob.roundActive = false;
    runtime.phase = "round-result";
    runtime.roundNumber = 3;
    runtime.resultsEndsAt = 0;
    runtime.suddenDeath = false;

    updateRuntime(runtime, 10_000);

    expect(runtime.phase).toBe("preparing");
    expect(runtime.suddenDeath).toBe(true);
    expect(player(runtime, "alice").participating).toBe(true);
    expect(bob.participating).toBe(true);
    expect(bob.roundActive).toBe(false);
  });

  it("continues the round for remaining players when one disconnects", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    const bob = player(runtime, "bob");
    bob.connected = false;
    bob.roundActive = false;
    bob.maxProgress = 0.9;
    advanceTo(runtime, runtime.raceEndsAt);
    expect(runtime.roundResult?.winnerSessionIds).toEqual(["alice"]);
  });

  it("returns to the lobby when nobody remains connected", () => {
    const runtime = makeRuntime(true);
    beginRace(runtime);
    for (const value of runtime.players.values()) {
      value.connected = false;
      value.roundActive = false;
    }
    advanceTo(runtime, runtime.raceStartedAt + 100);
    expect(runtime.phase).toBe("lobby");
  });

  it("returns to the lobby instead of crashing when the route pool is exhausted", () => {
    const runtime = makeRuntime(true);
    runtime.usedRouteIds = new Set(ROUTES_BY_DIFFICULTY.medium.map((route) => route.id));
    runtime.phase = "round-result";
    runtime.roundNumber = 1;
    runtime.resultsEndsAt = 0;
    runtime.suddenDeath = false;
    expect(() => updateRuntime(runtime, 10_000)).not.toThrow();
    expect(runtime.phase).toBe("lobby");
  });
});
