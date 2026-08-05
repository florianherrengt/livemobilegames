import { describe, expect, it } from "vitest";

import { CAPITALS } from "../../../src/games/capital-pin/capitals.js";
import { selectUniqueCapitals, shuffle } from "../../../src/games/capital-pin/selection.js";

function seededRandom(): () => number {
  let seed = 42;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe("selection", () => {
  it("selects unique capitals without mutating the source", () => {
    const source = [...CAPITALS];
    const selected = selectUniqueCapitals(CAPITALS, 10, seededRandom());
    expect(selected).toHaveLength(10);
    expect(new Set(selected.map((c) => c.id)).size).toBe(10);
    expect(CAPITALS).toEqual(source);
  });

  it("is deterministic for the same random source", () => {
    const a = selectUniqueCapitals(CAPITALS, 5, seededRandom());
    const b = selectUniqueCapitals(CAPITALS, 5, seededRandom());
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("returns all entries when asked for more than the dataset", () => {
    const selected = selectUniqueCapitals(CAPITALS, 10_000, seededRandom());
    expect(selected).toHaveLength(CAPITALS.length);
  });

  it("returns an empty array for an empty source", () => {
    expect(selectUniqueCapitals([], 5)).toEqual([]);
  });

  it("shuffles into a new array", () => {
    const input = [1, 2, 3, 4, 5];
    const output = shuffle(input, seededRandom());
    expect(output).not.toBe(input);
    expect([...output].sort()).toEqual([...input].sort());
  });
});
