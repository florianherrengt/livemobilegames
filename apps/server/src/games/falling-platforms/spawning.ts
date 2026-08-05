import { FALLING_PLATFORMS_SERVER_CONSTANTS } from "./constants.js";
import type { RuntimePlatform } from "./types.js";

/** Deterministic Fisher-Yates shuffle driven by a seeded rng. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    const swap = result[j];
    if (tmp === undefined || swap === undefined) {
      throw new Error("shuffle index out of bounds");
    }
    result[i] = swap;
    result[j] = tmp;
  }
  return result;
}

export function createPlatforms(arenaSide: number): RuntimePlatform[] {
  const platforms: RuntimePlatform[] = [];
  for (let gridY = 0; gridY < arenaSide; gridY++) {
    for (let gridX = 0; gridX < arenaSide; gridX++) {
      platforms.push({
        id: `${gridX}:${gridY}`,
        gridX,
        gridY,
        state: "stable",
        goneAt: 0,
      });
    }
  }
  return platforms;
}

function chebyshev(aX: number, aY: number, bX: number, bY: number): number {
  return Math.max(Math.abs(aX - bX), Math.abs(aY - bY));
}

/**
 * Selects unique spawn platforms spread across the arena. Candidates are
 * shuffled with the match seed, then greedily chosen to maximise the minimum
 * Chebyshev distance from the spawns already picked. In E2E test mode the
 * first two spawns are fixed to known tiles so browser tests are exact.
 */
export function selectSpawns(
  arenaSide: number,
  playerCount: number,
  rng: () => number,
  e2eMode: boolean,
): string[] {
  if (e2eMode && playerCount <= FALLING_PLATFORMS_SERVER_CONSTANTS.E2E_SPAWNS.length) {
    return FALLING_PLATFORMS_SERVER_CONSTANTS.E2E_SPAWNS.slice(0, playerCount);
  }

  const candidates: Array<{ gridX: number; gridY: number }> = [];
  for (let gridY = 0; gridY < arenaSide; gridY++) {
    for (let gridX = 0; gridX < arenaSide; gridX++) {
      candidates.push({ gridX, gridY });
    }
  }

  const order = shuffle(candidates, rng);
  const chosen: Array<{ gridX: number; gridY: number }> = [];
  const first = order.shift();
  if (first) {
    chosen.push(first);
  }

  while (chosen.length < playerCount && order.length > 0) {
    let best: { gridX: number; gridY: number } | null = null;
    let bestDistance = -1;
    for (const candidate of order) {
      let minDistance = Number.POSITIVE_INFINITY;
      for (const pick of chosen) {
        minDistance = Math.min(
          minDistance,
          chebyshev(candidate.gridX, candidate.gridY, pick.gridX, pick.gridY),
        );
      }
      if (minDistance > bestDistance) {
        bestDistance = minDistance;
        best = candidate;
      }
    }
    if (best) {
      chosen.push(best);
      order.splice(order.indexOf(best), 1);
    } else {
      break;
    }
  }

  return chosen.map(({ gridX, gridY }) => `${gridX}:${gridY}`);
}
