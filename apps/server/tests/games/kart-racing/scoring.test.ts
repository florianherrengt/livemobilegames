import { describe, expect, it } from "vitest";

import {
  createRuntime,
  createRuntimePlayer,
  createSettings,
} from "../../../src/games/kart-racing/runtime.js";
import { buildKartRacingResult } from "../../../src/games/kart-racing/scoring.js";
import type { KartRacingRuntime } from "../../../src/games/kart-racing/types.js";

function runtimeWithPlayers(): KartRacingRuntime {
  const runtime = createRuntime(createSettings(true));
  for (const [index, name] of ["Alice", "Bob", "Carol"].entries()) {
    const player = createRuntimePlayer(
      `session-${index}`,
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name,
      index,
      "",
    );
    runtime.players.set(`session-${index}`, player);
  }
  return runtime;
}

describe("Kart Racing match scoring", () => {
  it("resolves ties by race wins then second and third places", () => {
    const runtime = runtimeWithPlayers();
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    const carol = runtime.players.get("session-2");
    if (!alice || !bob || !carol) {
      throw new Error("missing players");
    }
    alice.matchPoints = 14;
    alice.raceWins = 2;
    bob.matchPoints = 14;
    bob.raceWins = 1;
    bob.secondPlaces = 2;
    carol.matchPoints = 10;

    const result = buildKartRacingResult(runtime);
    expect(result.leaderboard.map((entry) => entry.label)).toEqual(["Alice", "Bob", "Carol"]);
    expect([...result.winnerSessionIds]).toEqual(["session-0"]);
  });

  it("uses final-race position before total time", () => {
    const runtime = runtimeWithPlayers();
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing players");
    }
    alice.matchPoints = 14;
    alice.raceWins = 1;
    alice.secondPlaces = 1;
    alice.lastRacePosition = 2;
    alice.totalRaceTimeMs = 80_000;
    bob.matchPoints = 14;
    bob.raceWins = 1;
    bob.secondPlaces = 1;
    bob.lastRacePosition = 1;
    bob.totalRaceTimeMs = 60_000;

    const result = buildKartRacingResult(runtime);
    expect(result.leaderboard[0]?.label).toBe("Bob");
    expect(result.leaderboard[1]?.label).toBe("Alice");
  });

  it("does not share placement when second- or third-place counts differ", () => {
    const runtime = runtimeWithPlayers();
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing players");
    }
    alice.matchPoints = 14;
    alice.raceWins = 1;
    alice.secondPlaces = 2;
    alice.lastRacePosition = 2;
    bob.matchPoints = 14;
    bob.raceWins = 1;
    bob.secondPlaces = 1;
    bob.lastRacePosition = 2;

    const result = buildKartRacingResult(runtime);
    expect(result.leaderboard[0]?.label).toBe("Alice");
    expect(result.leaderboard[0]?.rank).toBe(1);
    expect(result.leaderboard[1]?.label).toBe("Bob");
    expect(result.leaderboard[1]?.rank).toBe(2);
    expect([...result.winnerSessionIds]).toEqual(["session-0"]);
  });

  it("ranks a player who never finished a race behind one with a real total time", () => {
    const runtime = runtimeWithPlayers();
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing players");
    }
    alice.matchPoints = 14;
    alice.raceWins = 1;
    alice.secondPlaces = 1;
    alice.lastRacePosition = 2;
    alice.totalRaceTimeMs = 0; // never finished a race
    bob.matchPoints = 14;
    bob.raceWins = 1;
    bob.secondPlaces = 1;
    bob.lastRacePosition = 2;
    bob.totalRaceTimeMs = 60_000;

    const result = buildKartRacingResult(runtime);
    expect(result.leaderboard[0]?.label).toBe("Bob");
    expect(result.leaderboard[1]?.label).toBe("Alice");
  });

  it("shares placement when every tie-breaker is identical", () => {
    const runtime = runtimeWithPlayers();
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing players");
    }
    alice.matchPoints = 14;
    bob.matchPoints = 14;
    alice.totalRaceTimeMs = 100_000;
    bob.totalRaceTimeMs = 100_000;

    const result = buildKartRacingResult(runtime);
    expect([...result.winnerSessionIds].sort()).toEqual(["session-0", "session-1"]);
    expect(result.leaderboard[0]?.rank).toBe(1);
    expect(result.leaderboard[1]?.rank).toBe(1);
  });
});
