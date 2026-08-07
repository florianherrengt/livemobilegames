import { COIN_RUSH_CONSTANTS, manhattanDistance } from "@phone-party/protocol";

import { randomPick } from "./rng.js";
import type { CoinRushRuntime, RuntimeCoin, RuntimePlayer } from "./types.js";
import { vehicleOverlapsCell } from "./vehicles.js";

export type CoinValue = 1 | 3 | 5;

interface CoinCandidate {
  col: number;
  row: number;
  distance: number;
}

function rowBand(value: CoinValue): readonly number[] {
  return COIN_RUSH_CONSTANTS.COIN_ROW_BANDS[value] ?? [5, 6];
}

function occupiedCells(runtime: CoinRushRuntime): Set<string> {
  const occupied = new Set<string>();
  for (const player of runtime.players.values()) {
    if (player.alive || player.moving) {
      occupied.add(`${player.x}:${player.y}`);
    }
    if (player.moving) {
      occupied.add(`${player.toX}:${player.toY}`);
    }
  }
  return occupied;
}

function candidates(
  runtime: CoinRushRuntime,
  value: CoinValue,
  occupied: ReadonlySet<string>,
  excludeCell: { col: number; row: number } | null,
  collector: RuntimePlayer | null,
  requireCollectorDistance: boolean,
): CoinCandidate[] {
  const rows = rowBand(value);
  const result: CoinCandidate[] = [];
  const currentCoins = [...runtime.coins.values()].filter((coin) => coin.value !== value);

  for (const row of rows) {
    const runtimeRow = runtime.rows.find((candidate) => candidate.row === row);
    for (let col = 0; col < COIN_RUSH_CONSTANTS.COL_COUNT; col++) {
      const key = `${col}:${row}`;
      if (occupied.has(key)) {
        continue;
      }
      if (excludeCell && excludeCell.col === col && excludeCell.row === row) {
        continue;
      }
      if (currentCoins.some((coin) => coin.col === col && coin.row === row)) {
        continue;
      }
      if (currentCoins.some((coin) => Math.abs(coin.row - row) < 4)) {
        continue;
      }
      if (runtimeRow && vehicleOverlapsCell(runtimeRow, runtime.elapsedMs, col)) {
        continue;
      }
      result.push({
        col,
        row,
        distance: collector
          ? manhattanDistance({ col, row }, { col: collector.x, row: collector.y })
          : Number.POSITIVE_INFINITY,
      });
    }
  }

  const usable = result;
  if (collector && requireCollectorDistance) {
    const preferred = usable.filter((candidate) => candidate.distance >= 3);
    if (preferred.length > 0) {
      return preferred;
    }
  }
  if (collector) {
    const farthest = Math.max(...usable.map((candidate) => candidate.distance));
    return usable.filter((candidate) => candidate.distance === farthest);
  }
  return usable;
}

/**
 * Spawns or respawns one coin of the given value.
 *
 * Initial spawns choose any valid cell in the value's row band. Replacement
 * coins first satisfy every preferred constraint (including Manhattan
 * distance at least 3 from the collector); when no cell satisfies all of
 * them, the valid cell farthest from the collector is chosen so the coin is
 * never missing.
 */
export function spawnCoin(
  runtime: CoinRushRuntime,
  value: CoinValue,
  options: {
    excludeCell?: { col: number; row: number };
    collector?: RuntimePlayer;
    now?: number;
  } = {},
): RuntimeCoin {
  const occupied = occupiedCells(runtime);
  const valid = candidates(
    runtime,
    value,
    occupied,
    options.excludeCell ?? null,
    options.collector ?? null,
    options.collector !== undefined,
  );
  const chosen = randomPick(runtime.rng, valid);
  const coin: RuntimeCoin = {
    value,
    col: chosen.col,
    row: chosen.row,
    visibleAt: (options.now ?? 0) + runtime.settings.coinPopMs,
  };
  runtime.coins.set(String(value), coin);
  return coin;
}

/** Spawns the initial 1-, 3-, and 5-point coins with row separation. */
export function spawnInitialCoins(runtime: CoinRushRuntime, now: number): void {
  for (const value of COIN_RUSH_CONSTANTS.COIN_VALUES) {
    spawnCoin(runtime, value, { now });
  }
}

export function coinAt(runtime: CoinRushRuntime, col: number, row: number): RuntimeCoin | null {
  for (const coin of runtime.coins.values()) {
    if (coin.col === col && coin.row === row) {
      return coin;
    }
  }
  return null;
}
