import type { FlappyRaceServerConstants } from "./constants.js";

/**
 * Deterministic course generation.
 *
 * In normal mode openings are derived only from the seed: the same seed and
 * configuration always produce the same sequence. In E2E mode the generator
 * emits a fixed alternating pattern (gap at the bottom for even obstacles,
 * gap at the top for odd ones) so browser and integration tests can force
 * deterministic collisions without any cheat controls.
 */
export function generateOpenings(
  config: FlappyRaceServerConstants,
  seed: string,
  count: number,
  e2eMode: boolean,
): number[] {
  const openings: number[] = [];
  if (e2eMode) {
    for (let index = 0; index < count; index++) {
      openings.push(index % 2 === 0 ? config.WORLD_HEIGHT - config.GAP_SIZE : 0);
    }
    return openings;
  }

  const rng = createCourseRng(seed);
  const minGapTop = config.UPPER_MARGIN;
  const maxGapTop = config.WORLD_HEIGHT - config.GAP_SIZE - config.LOWER_MARGIN;
  const range = maxGapTop - minGapTop + 1;
  for (let index = 0; index < count; index++) {
    const gapTop = minGapTop + Math.floor(rng() * range);
    openings.push(gapTop);
  }
  return openings;
}

/** Small deterministic PRNG (mulberry32) seeded from the course seed string. */
function createCourseRng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
