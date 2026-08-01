import { describe, expect, it } from "vitest";
import { CAPITALS } from "../src/capitals.js";
import { selectUniqueCapitals, shuffle } from "../src/selection.js";
import type { Capital } from "../src/types.js";

describe("shuffle", () => {
  it("returns a new array and does not mutate the input", () => {
    const original = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const snapshot = original.map((x) => ({ ...x }));
    const result = shuffle(original);
    expect(original).toEqual(snapshot); // unchanged
    expect(result).not.toBe(original); // new array
    expect(result).toHaveLength(original.length);
  });

  it("preserves the same multiset of elements", () => {
    const result = shuffle(CAPITALS);
    expect(result).toHaveLength(CAPITALS.length);
    const byId = (arr: readonly Capital[]) => new Set(arr.map((c) => c.id));
    expect(byId(result)).toEqual(byId(CAPITALS));
  });
});

describe("selectUniqueCapitals", () => {
  it("returns exactly the requested count", () => {
    const selected = selectUniqueCapitals(CAPITALS, 10);
    expect(selected).toHaveLength(10);
  });

  it("contains no duplicate capitals", () => {
    const selected = selectUniqueCapitals(CAPITALS, 10);
    const ids = selected.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not mutate the source dataset", () => {
    const snapshot = CAPITALS.map((c) => ({ ...c }));
    selectUniqueCapitals(CAPITALS, 10);
    expect(CAPITALS.map((c) => ({ ...c }))).toEqual(snapshot);
  });

  it("returns at most the dataset size when count exceeds it", () => {
    const small: Capital[] = [
      { id: "a", city: "A", country: "AA", latitude: 0, longitude: 0 },
      { id: "b", city: "B", country: "BB", latitude: 1, longitude: 1 },
    ];
    const selected = selectUniqueCapitals(small, 10);
    expect(selected).toHaveLength(2);
    expect(new Set(selected.map((c) => c.id)).size).toBe(2);
  });

  it("handles empty dataset", () => {
    expect(selectUniqueCapitals([], 10)).toEqual([]);
  });

  it("handles count of zero", () => {
    expect(selectUniqueCapitals(CAPITALS, 0)).toEqual([]);
  });
});
