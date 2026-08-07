import { COIN_RUSH_CONSTANTS, manhattanDistance } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import { spawnCoin, spawnInitialCoins } from "../../../src/games/coin-rush/coins.js";
import { generateRows } from "../../../src/games/coin-rush/map.js";
import { createRng } from "../../../src/games/coin-rush/rng.js";
import { addPlayerAt, makeRuntime } from "./helpers.js";

function runtimeWithMap(): ReturnType<typeof makeRuntime> {
  const runtime = makeRuntime({ e2eMode: true });
  runtime.rows = generateRows("coin-unit-seed", true);
  runtime.rng = createRng("coin-unit-seed");
  runtime.phase = "playing";
  runtime.elapsedMs = 0;
  return runtime;
}

describe("Coin Rush coin spawning", () => {
  it("spawns exactly one coin of each value in the correct regions", () => {
    const runtime = runtimeWithMap();
    addPlayerAt(runtime, "a", "A", 4, 0);
    addPlayerAt(runtime, "b", "B", 4, 1);
    spawnInitialCoins(runtime, 1_000);
    expect(runtime.coins.size).toBe(3);
    for (const value of COIN_RUSH_CONSTANTS.COIN_VALUES) {
      const coin = runtime.coins.get(String(value));
      expect(coin).toBeDefined();
      expect(coin?.value).toBe(value);
      const band = COIN_RUSH_CONSTANTS.COIN_ROW_BANDS[value];
      expect(band).toContain(coin?.row);
    }
  });

  it("keeps initial coins separated by at least three complete rows", () => {
    const runtime = runtimeWithMap();
    addPlayerAt(runtime, "a", "A", 4, 0);
    addPlayerAt(runtime, "b", "B", 4, 1);
    spawnInitialCoins(runtime, 1_000);
    const values = [...runtime.coins.values()];
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        expect(Math.abs((values[i]?.row ?? 0) - (values[j]?.row ?? 0))).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("never places an initial coin on a player or inside a vehicle", () => {
    const runtime = runtimeWithMap();
    addPlayerAt(runtime, "a", "A", 4, 0);
    addPlayerAt(runtime, "b", "B", 4, 1);
    spawnInitialCoins(runtime, 1_000);
    for (const coin of runtime.coins.values()) {
      expect(coin.col === 4 && (coin.row === 0 || coin.row === 1)).toBe(false);
      const row = runtime.rows.find((candidate) => candidate.row === coin.row);
      if (row?.terrain === "road") {
        // At elapsed 0 the coin cell is never covered by the row's vehicle.
        const left = row.offset;
        expect(coin.col < left || coin.col >= left + row.vehicleLength).toBe(true);
      }
    }
  });

  it("respawns a collected coin in the same region, not on the old cell or the collector", () => {
    const runtime = runtimeWithMap();
    addPlayerAt(runtime, "a", "A", 1, 1);
    spawnInitialCoins(runtime, 1_000);
    const old = runtime.coins.get("1");
    if (!old) {
      throw new Error("missing coin");
    }
    const collector = runtime.players.get("a");
    if (!collector) {
      throw new Error("missing player");
    }
    const replacement = spawnCoin(runtime, 1, {
      excludeCell: { col: old.col, row: old.row },
      collector,
      now: 1_000,
    });
    expect(replacement.row).toBeGreaterThanOrEqual(5);
    expect(replacement.row).toBeLessThanOrEqual(6);
    expect(replacement.col === old.col && replacement.row === old.row).toBe(false);
    expect(replacement.col === collector.x && replacement.row === collector.y).toBe(false);
    expect(
      manhattanDistance(
        { col: replacement.col, row: replacement.row },
        { col: collector.x, row: collector.y },
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  it("always terminates and keeps exactly one coin of each value", () => {
    const runtime = runtimeWithMap();
    addPlayerAt(runtime, "a", "A", 1, 1);
    spawnInitialCoins(runtime, 1_000);
    const collector = runtime.players.get("a");
    if (!collector) {
      throw new Error("missing player");
    }
    for (let index = 0; index < 50; index++) {
      spawnCoin(runtime, 5, {
        excludeCell: { col: index % 9, row: 15 },
        collector,
        now: 1_000 + index,
      });
      expect(runtime.coins.size).toBe(3);
    }
  });

  it("never runs out of valid spawn cells across many production seeds", () => {
    for (let seedIndex = 0; seedIndex < 100; seedIndex++) {
      const seed = `stress-${seedIndex}`;
      const runtime = makeRuntime();
      runtime.rows = generateRows(seed, false);
      runtime.rng = createRng(seed);
      runtime.phase = "playing";
      runtime.elapsedMs = 0;
      for (let index = 0; index < 8; index++) {
        addPlayerAt(
          runtime,
          `p${index}`,
          `Player ${index}`,
          Math.floor((index * COIN_RUSH_CONSTANTS.COL_COUNT) / 8),
          index % 2,
        );
      }
      spawnInitialCoins(runtime, 1_000);
      const collector = runtime.players.get("p0");
      if (!collector) {
        throw new Error("missing player");
      }
      for (let replacement = 0; replacement < 50; replacement++) {
        spawnCoin(runtime, 5, {
          excludeCell: { col: replacement % COIN_RUSH_CONSTANTS.COL_COUNT, row: 15 },
          collector,
          now: 1_000 + replacement,
        });
        expect(runtime.coins.size).toBe(3);
      }
    }
  });
});
