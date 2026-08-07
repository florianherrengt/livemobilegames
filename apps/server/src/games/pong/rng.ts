import { randomBytes } from "node:crypto";

import { PONG_SERVER_CONSTANTS } from "./constants.js";

/**
 * Deterministic per-match seed. Production uses crypto; E2E mode uses a fixed
 * seed so integration and browser tests see the same layouts and launches.
 */
export function createMatchSeed(e2eMode: boolean): string {
  if (e2eMode) {
    return PONG_SERVER_CONSTANTS.E2E_SEED;
  }
  return randomBytes(16).toString("hex");
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG (mulberry32) for layout and ball randomness. */
export function createMatchRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
