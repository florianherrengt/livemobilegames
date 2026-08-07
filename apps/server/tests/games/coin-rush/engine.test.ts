import { COIN_RUSH_CONSTANTS } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import {
  addPlayer,
  startMatch,
  startPlaying,
  updateRuntime,
} from "../../../src/games/coin-rush/engine.js";
import type { CoinRushRuntime, RuntimeRow } from "../../../src/games/coin-rush/types.js";
import { makeRuntime, player } from "./helpers.js";

function connectedRuntime(): CoinRushRuntime {
  const runtime = makeRuntime({ e2eMode: true });
  addPlayer(runtime, "a", "Alice", 0);
  addPlayer(runtime, "b", "Bob", 1);
  return runtime;
}

function roadRow(row: number, offset: number): RuntimeRow {
  return {
    row,
    terrain: "road",
    direction: 1,
    speed: 0,
    vehicleLength: 1,
    spacing: 10,
    offset,
  };
}

describe("Coin Rush round lifecycle", () => {
  it("starts a countdown, generates one fixed map, and enters play", () => {
    const runtime = connectedRuntime();
    expect(startMatch(runtime, 1_000)).toBe(true);
    expect(runtime.phase).toBe("countdown");
    expect(runtime.totalRounds).toBe(3);
    expect(runtime.rows).toHaveLength(COIN_RUSH_CONSTANTS.ROW_COUNT);
    expect(runtime.coins.size).toBe(3);
    for (const value of COIN_RUSH_CONSTANTS.COIN_VALUES) {
      expect(runtime.coins.get(String(value))?.value).toBe(value);
    }
    expect(runtime.players.get("a")?.alive).toBe(true);
    expect(runtime.players.get("a")?.y).toBeLessThan(2);
    expect(runtime.players.get("b")?.y).toBeLessThan(2);

    const mapBefore = JSON.stringify(runtime.rows);
    updateRuntime(runtime, 1_000 + runtime.settings.countdownMs + 1);
    expect(runtime.phase).toBe("playing");
    expect(JSON.stringify(runtime.rows)).toBe(mapBefore);
  });

  it("collects a coin only when a player finishes on it", () => {
    const runtime = connectedRuntime();
    startMatch(runtime, 1_000);
    startPlaying(runtime, 2_000);
    const alice = player(runtime, "a");
    alice.x = 2;
    alice.y = 5;
    alice.fromX = 2;
    alice.fromY = 5;
    const coin = runtime.coins.get("1");
    if (!coin) {
      throw new Error("missing coin");
    }
    coin.col = 3;
    coin.row = 5;
    runtime.pendingMoves.set("a", { sequence: 1, direction: "right" });
    updateRuntime(runtime, 2_050);
    updateRuntime(runtime, 2_200);
    expect(alice.score).toBe(1);
    expect(alice.totalCoins).toBe(1);
    expect(runtime.coins.get("1")?.col).not.toBe(3);
  });

  it("ends the round immediately at ten points and keeps round wins across rounds", () => {
    const runtime = connectedRuntime();
    startMatch(runtime, 1_000);
    startPlaying(runtime, 2_000);
    const alice = player(runtime, "a");
    alice.x = 2;
    alice.y = 5;
    alice.fromX = 2;
    alice.fromY = 5;
    alice.score = 9;
    const coin = runtime.coins.get("1");
    if (!coin) {
      throw new Error("missing coin");
    }
    coin.col = 3;
    coin.row = 5;
    runtime.pendingMoves.set("a", { sequence: 1, direction: "right" });
    updateRuntime(runtime, 2_050);
    updateRuntime(runtime, 2_200);
    expect(runtime.phase).toBe("round-result");
    expect(runtime.roundWinnerSessionIds).toEqual(["a"]);
    expect(alice.roundWins).toBe(1);
    expect(alice.moving).toBe(false);

    updateRuntime(runtime, runtime.roundResultEndsAt + 1);
    expect(runtime.phase).toBe("countdown");
    expect(runtime.roundNumber).toBe(2);
    expect(alice.score).toBe(0);
    expect(alice.roundWins).toBe(1);
  });

  it("plays exactly three rounds and then finishes with a result", () => {
    const runtime = connectedRuntime();
    let now = 1_000;
    startMatch(runtime, now);
    now += runtime.settings.countdownMs + 1;
    updateRuntime(runtime, now);
    expect(runtime.phase).toBe("playing");

    for (let round = 1; round <= 3; round++) {
      expect(runtime.roundNumber).toBe(round);
      const alice = player(runtime, "a");
      alice.score = 10;
      updateRuntime(runtime, now + 1);
      expect(runtime.phase).toBe("round-result");
      expect(runtime.roundWinnerSessionIds).toEqual(["a"]);
      now = runtime.roundResultEndsAt + 1;
      updateRuntime(runtime, now);
      if (round < 3) {
        expect(runtime.phase).toBe("countdown");
        now += runtime.settings.countdownMs + 1;
        updateRuntime(runtime, now);
        expect(runtime.phase).toBe("playing");
      }
    }
    expect(runtime.phase).toBe("finished");
    expect(runtime.result).not.toBeNull();
    expect(runtime.result?.winnerSessionIds).toEqual(["a"]);
    expect(runtime.players.get("a")?.roundWins).toBe(3);
  });
});

describe("Coin Rush deaths and respawns", () => {
  it("kills a stationary player hit by a vehicle and respawns them in the safe area", () => {
    const runtime = connectedRuntime();
    runtime.rows = Array.from({ length: COIN_RUSH_CONSTANTS.ROW_COUNT }, (_, row) =>
      row === 4
        ? roadRow(4, 3)
        : ({
            row,
            terrain: "safe",
            direction: 0,
            speed: 0,
            vehicleLength: 0,
            spacing: 0,
            offset: 0,
          } as RuntimeRow),
    );
    const alice = player(runtime, "a");
    alice.alive = true;
    alice.x = 3;
    alice.y = 4;
    runtime.phase = "playing";
    runtime.lastTickAt = 10_000;
    runtime.elapsedMs = 0;

    updateRuntime(runtime, 10_000);
    expect(alice.alive).toBe(false);
    expect(alice.deathType).toBe("vehicle");
    expect(alice.respawning).toBe(true);

    updateRuntime(runtime, alice.respawnEndsAt + 1);
    expect(alice.alive).toBe(true);
    expect(alice.respawning).toBe(false);
    // The primary starting row is preferred for respawns.
    expect(alice.y).toBe(0);
  });

  it("kills a player pushed into a vehicle and still completes the push", () => {
    const runtime = connectedRuntime();
    runtime.rows = Array.from({ length: COIN_RUSH_CONSTANTS.ROW_COUNT }, (_, row) =>
      row === 5
        ? roadRow(5, 4)
        : ({
            row,
            terrain: "safe",
            direction: 0,
            speed: 0,
            vehicleLength: 0,
            spacing: 0,
            offset: 0,
          } as RuntimeRow),
    );
    const alice = player(runtime, "a");
    const bob = player(runtime, "b");
    alice.alive = true;
    bob.alive = true;
    alice.x = 2;
    alice.y = 5;
    bob.x = 3;
    bob.y = 5;
    runtime.phase = "playing";
    runtime.lastTickAt = 20_000;
    runtime.elapsedMs = 0;
    runtime.pendingMoves.set("a", { sequence: 1, direction: "right" });

    updateRuntime(runtime, 20_000);
    expect(alice.toX).toBe(3);
    expect(bob.toX).toBe(4);
    expect(bob.alive).toBe(false);
    expect(bob.deathType).toBe("vehicle");
  });
});

describe("Coin Rush push and simultaneous scoring", () => {
  it("awards a coin to a pushed player, not the pusher", () => {
    const runtime = connectedRuntime();
    startMatch(runtime, 1_000);
    startPlaying(runtime, 2_000);
    const alice = player(runtime, "a");
    const bob = player(runtime, "b");
    runtime.rows = Array.from(
      { length: COIN_RUSH_CONSTANTS.ROW_COUNT },
      (_, row) =>
        ({
          row,
          terrain: "safe",
          direction: 0,
          speed: 0,
          vehicleLength: 0,
          spacing: 0,
          offset: 0,
        }) as RuntimeRow,
    );
    alice.x = 2;
    alice.y = 5;
    bob.x = 3;
    bob.y = 5;
    alice.fromX = 2;
    alice.fromY = 5;
    bob.fromX = 3;
    bob.fromY = 5;
    const coin = runtime.coins.get("1");
    if (!coin) {
      throw new Error("missing coin");
    }
    coin.col = 4;
    coin.row = 5;
    runtime.pendingMoves.set("a", { sequence: 1, direction: "right" });
    updateRuntime(runtime, 2_050);
    updateRuntime(runtime, 2_200);
    expect(bob.score).toBe(1);
    expect(alice.score).toBe(0);
    expect(bob.toX).toBe(4);
  });

  it("makes both players bounce when they target the same coin and leaves it in place", () => {
    const runtime = connectedRuntime();
    startMatch(runtime, 1_000);
    startPlaying(runtime, 2_000);
    runtime.rows = Array.from(
      { length: COIN_RUSH_CONSTANTS.ROW_COUNT },
      (_, row) =>
        ({
          row,
          terrain: "safe",
          direction: 0,
          speed: 0,
          vehicleLength: 0,
          spacing: 0,
          offset: 0,
        }) as RuntimeRow,
    );
    const alice = player(runtime, "a");
    const bob = player(runtime, "b");
    alice.x = 2;
    alice.y = 5;
    bob.x = 4;
    bob.y = 5;
    alice.fromX = 2;
    alice.fromY = 5;
    bob.fromX = 4;
    bob.fromY = 5;
    const coin = runtime.coins.get("1");
    if (!coin) {
      throw new Error("missing coin");
    }
    coin.col = 3;
    coin.row = 5;
    runtime.pendingMoves.set("a", { sequence: 1, direction: "right" });
    runtime.pendingMoves.set("b", { sequence: 1, direction: "left" });
    updateRuntime(runtime, 2_050);
    expect(alice.bouncing).toBe(true);
    expect(bob.bouncing).toBe(true);
    expect(alice.score).toBe(0);
    expect(bob.score).toBe(0);
    expect(runtime.coins.get("1")?.col).toBe(3);
    expect(runtime.coins.get("1")?.row).toBe(5);
    updateRuntime(runtime, 2_200);
    expect(alice.bouncing).toBe(false);
    expect(bob.bouncing).toBe(false);
  });

  it("awards multiple coins in one chain push and detects the simultaneous threshold tie", () => {
    const runtime = connectedRuntime();
    const players = ["c", "d", "e", "f", "g"] as const;
    const added = players.map((sessionId, index) =>
      addPlayer(runtime, sessionId, `Player ${index + 2}`, index + 2),
    );
    startMatch(runtime, 1_000);
    startPlaying(runtime, 2_000);
    runtime.rows = Array.from(
      { length: COIN_RUSH_CONSTANTS.ROW_COUNT },
      (_, row) =>
        ({
          row,
          terrain: "safe",
          direction: 0,
          speed: 0,
          vehicleLength: 0,
          spacing: 0,
          offset: 0,
        }) as RuntimeRow,
    );
    const alice = player(runtime, "a");
    const bob = player(runtime, "b");
    const positions = [
      { x: 4, y: 4 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 4, y: 9 },
      { x: 4, y: 10 },
    ];
    const ordered = [alice, bob, ...added];
    ordered.forEach((playerState, index) => {
      const position = positions[index];
      if (!position) {
        throw new Error("missing position");
      }
      playerState.x = position.x;
      playerState.y = position.y;
      playerState.fromX = position.x;
      playerState.fromY = position.y;
    });
    bob.score = 9;
    const last = added[added.length - 1];
    if (!last) {
      throw new Error("missing last player");
    }
    last.score = 7;
    const coinOne = runtime.coins.get("1");
    const coinThree = runtime.coins.get("3");
    if (!coinOne || !coinThree) {
      throw new Error("missing coin");
    }
    coinOne.col = 4;
    coinOne.row = 6;
    coinThree.col = 4;
    coinThree.row = 11;
    runtime.pendingMoves.set("a", { sequence: 1, direction: "up" });
    updateRuntime(runtime, 2_050);

    expect(alice.toY).toBe(5);
    expect(bob.toY).toBe(6);
    expect(last.toY).toBe(11);
    expect(bob.score).toBe(10);
    expect(last.score).toBe(10);
    expect(runtime.suddenDeath).toBe(true);
    expect(bob.suddenDeathEligible).toBe(true);
    expect(last.suddenDeathEligible).toBe(true);
  });

  it("enters sudden death on an exact threshold tie and resolves on the next eligible coin", () => {
    const runtime = connectedRuntime();
    startMatch(runtime, 1_000);
    startPlaying(runtime, 2_000);
    runtime.rows = Array.from(
      { length: COIN_RUSH_CONSTANTS.ROW_COUNT },
      (_, row) =>
        ({
          row,
          terrain: "safe",
          direction: 0,
          speed: 0,
          vehicleLength: 0,
          spacing: 0,
          offset: 0,
        }) as RuntimeRow,
    );
    const alice = player(runtime, "a");
    const bob = player(runtime, "b");
    alice.x = 2;
    alice.y = 5;
    bob.x = 2;
    bob.y = 10;
    alice.fromX = 2;
    alice.fromY = 5;
    bob.fromX = 2;
    bob.fromY = 10;
    alice.score = 9;
    bob.score = 7;
    const coinOne = runtime.coins.get("1");
    const coinThree = runtime.coins.get("3");
    if (!coinOne || !coinThree) {
      throw new Error("missing coin");
    }
    coinOne.col = 3;
    coinOne.row = 5;
    coinThree.col = 3;
    coinThree.row = 10;
    runtime.pendingMoves.set("a", { sequence: 1, direction: "right" });
    runtime.pendingMoves.set("b", { sequence: 1, direction: "right" });
    updateRuntime(runtime, 2_050);
    updateRuntime(runtime, 2_200);

    expect(runtime.suddenDeath).toBe(true);
    expect(runtime.phase).toBe("playing");
    expect(alice.suddenDeathEligible).toBe(true);
    expect(bob.suddenDeathEligible).toBe(true);

    bob.suddenDeathEligible = false;
    const newCoin = runtime.coins.get("1");
    if (!newCoin) {
      throw new Error("missing coin");
    }
    newCoin.col = 4;
    newCoin.row = 5;
    alice.x = 3;
    alice.y = 5;
    alice.fromX = 3;
    alice.fromY = 5;
    alice.moving = false;
    runtime.pendingMoves.set("a", { sequence: 2, direction: "right" });
    updateRuntime(runtime, 2_300);
    updateRuntime(runtime, 2_400);
    expect(runtime.phase).toBe("round-result");
    expect(runtime.roundWinnerSessionIds).toEqual(["a"]);
    expect(alice.roundWins).toBe(1);
  });
});
