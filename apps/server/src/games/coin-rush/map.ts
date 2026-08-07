import { COIN_RUSH_CONSTANTS } from "@phone-party/protocol";

import { randomInt, randomPick } from "./rng.js";
import type { RuntimeRow } from "./types.js";

const LOWER_ROWS = [2, 3, 4, 5, 6] as const;
const MIDDLE_ROWS = [7, 8, 9, 10, 11] as const;
const UPPER_ROWS = [12, 13, 14, 15, 16] as const;

/**
 * Generates one fixed map for a round.
 *
 * The bottom two rows are always safe. The lower area has a minority of slow,
 * widely spaced roads, the middle area has more roads with faster traffic and
 * alternating directions, and the upper area is entirely consecutive road rows
 * with the fastest, densest traffic. The map never changes during a round, and
 * the same seed always produces the same map for every client.
 */
export function generateRows(seed: string, e2eMode: boolean): RuntimeRow[] {
  const rng = createRowRng(seed);
  const rows: RuntimeRow[] = [];
  let lastDirection: -1 | 1 | undefined;
  // Guarantee the lower area always has some danger and the middle area is
  // noticeably harder, regardless of the random seed.
  const lowerRoadCount = e2eMode ? 1 : randomInt(rng, 1, 2);
  const middleRoadCount = e2eMode ? 0 : randomInt(rng, 3, 4);
  const lowerRoads = new Set(pickRows(rng, LOWER_ROWS, lowerRoadCount));
  const middleRoads = new Set(pickRows(rng, MIDDLE_ROWS, middleRoadCount));

  for (let row = 0; row < COIN_RUSH_CONSTANTS.ROW_COUNT; row++) {
    if (row < COIN_RUSH_CONSTANTS.SAFE_ROWS) {
      rows.push(safeRow(row));
      continue;
    }

    if (UPPER_ROWS.includes(row as (typeof UPPER_ROWS)[number])) {
      if (e2eMode) {
        rows.push(safeRow(row));
        continue;
      }
      const direction = lastDirection === 1 ? -1 : 1;
      lastDirection = direction;
      rows.push(
        roadRow(
          row,
          direction,
          e2eMode ? 1.5 + rng() * 0.5 : 4.2 + rng() * 1.2,
          e2eMode ? 1 : 2 + randomInt(rng, 0, 1),
          e2eMode ? 9 : randomInt(rng, 5, 6),
        ),
      );
      continue;
    }

    if (middleRoads.has(row as (typeof MIDDLE_ROWS)[number])) {
      const direction = lastDirection === 1 ? -1 : lastDirection === -1 ? 1 : rng() < 0.5 ? -1 : 1;
      lastDirection = direction;
      rows.push(
        roadRow(
          row,
          direction,
          e2eMode ? 0.8 + rng() * 0.4 : 2.4 + rng() * 1.0,
          e2eMode ? 1 : 1 + randomInt(rng, 0, 1),
          e2eMode ? 10 : randomInt(rng, 7, 8),
        ),
      );
      continue;
    }

    if (!lowerRoads.has(row as (typeof LOWER_ROWS)[number])) {
      rows.push(safeRow(row));
      continue;
    }
    const direction = lastDirection === 1 ? -1 : lastDirection === -1 ? 1 : rng() < 0.5 ? -1 : 1;
    lastDirection = direction;
    rows.push(
      roadRow(
        row,
        direction,
        e2eMode ? 0.5 + rng() * 0.3 : 1.0 + rng() * 0.8,
        1,
        e2eMode ? 10 : randomInt(rng, 9, 10),
      ),
    );
  }

  if (e2eMode) {
    // A stationary test vehicle on row 4 gives real-socket vehicle-collision
    // tests a deterministic, always-covered cell without changing production
    // traffic.
    const testRow = rows.find((candidate) => candidate.row === 4);
    if (testRow) {
      testRow.terrain = "road";
      testRow.direction = 1;
      testRow.speed = 0;
      testRow.vehicleLength = 1;
      testRow.spacing = 10;
      testRow.offset = 5;
    }
  }

  return rows;
}

function pickRows(rng: () => number, candidates: readonly number[], count: number): number[] {
  const pool = [...candidates];
  for (let index = pool.length - 1; index > 0; index--) {
    const swapIndex = randomInt(rng, 0, index);
    const current = pool[index];
    const swap = pool[swapIndex];
    if (current !== undefined && swap !== undefined) {
      pool[index] = swap;
      pool[swapIndex] = current;
    }
  }
  return pool.slice(0, count);
}

function safeRow(row: number): RuntimeRow {
  return {
    row,
    terrain: "safe",
    direction: 0,
    speed: 0,
    vehicleLength: 0,
    spacing: 0,
    offset: 0,
  };
}

function roadRow(
  row: number,
  direction: -1 | 1,
  speed: number,
  vehicleLength: number,
  spacing: number,
): RuntimeRow {
  const rng = createRowRng(`row-${row}-${direction}-${speed}-${vehicleLength}-${spacing}`);
  return {
    row,
    terrain: "road",
    direction,
    speed,
    vehicleLength,
    spacing,
    offset: Math.floor(rng() * spacing),
  };
}

function createRowRng(seed: string): () => number {
  let state = hash(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(seed: string): number {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function rowByNumber(rows: readonly RuntimeRow[], row: number): RuntimeRow | undefined {
  return rows.find((candidate) => candidate.row === row);
}

export function isRoadRow(rows: readonly RuntimeRow[], row: number): boolean {
  return rowByNumber(rows, row)?.terrain === "road";
}

export function randomDirection(rng: () => number): -1 | 1 {
  return randomPick(rng, [-1, 1] as const);
}
