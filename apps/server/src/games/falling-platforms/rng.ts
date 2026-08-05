import { randomBytes } from "node:crypto";

import { FALLING_PLATFORMS_SERVER_CONSTANTS } from "./constants.js";

/**
 * Server-authoritative random seed source. Game seeds use the same crypto RNG
 * as codes and tokens; Math.random is not acceptable for authoritative state.
 */
export function generateMatchSeed(e2eMode: boolean): string {
  return e2eMode
    ? FALLING_PLATFORMS_SERVER_CONSTANTS.E2E_MATCH_SEED
    : randomBytes(16).toString("hex");
}

/** Small deterministic PRNG (mulberry32) seeded from the match seed string. */
export function createMatchRng(seed: string): () => number {
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
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}
