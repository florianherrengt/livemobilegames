import type { Capital } from "./types.js";

/** A function returning a float in [0, 1). Defaults to Math.random. */
export type RandomSource = () => number;

/**
 * Fisher-Yates shuffle using an injectable random source. Returns a new array;
 * does not mutate the input.
 */
export function shuffle<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = copy[i];
    const swap = copy[j];
    if (tmp === undefined || swap === undefined) {
      throw new Error("shuffle index out of bounds");
    }
    copy[i] = swap;
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Select `count` unique capitals using a Fisher-Yates shuffle.
 * If the dataset has fewer than `count` entries, all of them are returned
 * (shuffled) — callers must guard for that case.
 */
export function selectUniqueCapitals(
  source: readonly Capital[],
  count: number,
  random: RandomSource = Math.random,
): Capital[] {
  const safeCount = Math.max(0, count);
  if (source.length === 0) {
    return [];
  }
  const shuffled = shuffle(source, random);
  const take = Math.min(safeCount, shuffled.length);
  return shuffled.slice(0, take);
}
