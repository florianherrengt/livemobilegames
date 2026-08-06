import { describe, expect, it } from "vitest";

import {
  createRuntime,
  createRuntimePlayer,
  createSettings,
  startMatch,
} from "../../../src/games/flappy-race/runtime.js";
import { evaluateRoundEnd, updateRuntime } from "../../../src/games/flappy-race/simulation.js";
import type { FlappyRaceRuntime } from "../../../src/games/flappy-race/types.js";

function makeRuntime(): FlappyRaceRuntime {
  const runtime = createRuntime(createSettings(true));
  runtime.players.set("alice", createRuntimePlayer("alice", "Alice", 0, "#0072B2"));
  runtime.players.set("bob", createRuntimePlayer("bob", "Bob", 1, "#E69F00"));
  expect(startMatch(runtime, 0)).toBe(true);
  return runtime;
}

function runUntil(
  runtime: FlappyRaceRuntime,
  predicate: (runtime: FlappyRaceRuntime) => boolean,
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

describe("Flappy Race simulation", () => {
  it("runs all five rounds and produces a tied scoreboard with no input", () => {
    const runtime = makeRuntime();
    runUntil(runtime, (current) => current.phase === "finished");
    expect(runtime.roundNumber).toBe(5);
    expect(runtime.result?.winnerSessionIds.sort()).toEqual(["alice", "bob"]);
    expect(runtime.result?.leaderboard.every((entry) => entry.primaryScore === 5)).toBe(true);
  });

  it("lets the sole eligible player win every remaining round after a disconnect", () => {
    const runtime = makeRuntime();
    const bob = runtime.players.get("bob");
    if (!bob) {
      throw new Error("Bob missing");
    }
    bob.connected = false;
    bob.eligible = false;
    bob.roundActive = false;
    evaluateRoundEnd(runtime, 100);
    expect(runtime.phase).toBe("round-result");
    expect([...runtime.roundWinnerSessionIds]).toEqual(["alice"]);

    runUntil(runtime, (current) => current.phase === "finished");
    expect(runtime.result?.winnerSessionIds).toEqual(["alice"]);
    const alice = runtime.result?.leaderboard.find((entry) => entry.sessionId === "alice");
    const bobEntry = runtime.result?.leaderboard.find((entry) => entry.sessionId === "bob");
    expect(alice?.primaryScore).toBe(5);
    expect(bobEntry?.primaryScore).toBe(0);
  });

  it("returns to the lobby when every player disconnects mid-round", () => {
    const runtime = makeRuntime();
    for (const player of runtime.players.values()) {
      player.connected = false;
      player.eligible = false;
      player.roundActive = false;
    }
    evaluateRoundEnd(runtime, 100);
    expect(runtime.phase).toBe("lobby");
    expect(runtime.roundNumber).toBe(0);
    expect(runtime.result).toBeNull();
  });
});
