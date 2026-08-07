import { randomInt } from "node:crypto";

/**
 * Uniform integer RNG used for turn order, reveal order, and word-deck
 * shuffling. Production uses node:crypto; tests and E2E mode inject a seeded
 * deterministic RNG so assertions are reproducible.
 */
export type IntRng = (maxExclusive: number) => number;

export function createCryptoIntRng(): IntRng {
  return (maxExclusive) => randomInt(maxExclusive);
}

export function createSeededIntRng(seed: string): IntRng {
  let state = hashSeed(seed);
  return (maxExclusive) => {
    // mulberry32 PRNG.
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const float = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    return Math.min(maxExclusive - 1, Math.floor(float * maxExclusive));
  };
}

function hashSeed(seed: string): number {
  // xmur3 string hash: stable across platforms for ASCII seeds.
  let hash = 2_166_136_261 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    hash ^= code;
    hash = Math.imul(hash, 16_777_619);
    hash = (hash >>> 0) + (hash >>> 13);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_359);
  hash ^= hash >>> 13;
  hash = Math.imul(hash ^ (hash >>> 16), 3_266_489_909);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** In-place Fisher-Yates shuffle using the injected integer RNG. */
export function shuffle<T>(items: readonly T[], rng: IntRng): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = rng(index + 1);
    const current = result[index];
    const other = result[swapIndex];
    if (current !== undefined && other !== undefined) {
      result[index] = other;
      result[swapIndex] = current;
    }
  }
  return result;
}
