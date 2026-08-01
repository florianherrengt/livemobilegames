import { describe, expect, it } from "vitest";

import { computeArenaSide, hopEaseOut, isAdjacent, parsePlatformId } from "../src/index.js";

describe("grid adjacency", () => {
  it("accepts orthogonal neighbours", () => {
    expect(isAdjacent(0, 0, 0, 1)).toBe(true);
    expect(isAdjacent(3, 3, 4, 3)).toBe(true);
    expect(isAdjacent(3, 3, 3, 2)).toBe(true);
  });

  it("accepts diagonal neighbours", () => {
    expect(isAdjacent(0, 0, 1, 1)).toBe(true);
    expect(isAdjacent(3, 3, 2, 4)).toBe(true);
  });

  it("rejects platforms two spaces away", () => {
    expect(isAdjacent(0, 0, 0, 2)).toBe(false);
    expect(isAdjacent(3, 3, 5, 3)).toBe(false);
    expect(isAdjacent(3, 3, 5, 5)).toBe(false);
  });
});

describe("arena sizing", () => {
  it("keeps a 7x7 arena for two players", () => {
    expect(computeArenaSide(2)).toBe(7);
  });

  it("grows with player count and stays odd", () => {
    for (const count of [2, 4, 8, 20, 50]) {
      const side = computeArenaSide(count);
      expect(side % 2).toBe(1);
      expect(side * side).toBeGreaterThanOrEqual(Math.max(49, count * 6));
    }
  });
});

describe("hop easing", () => {
  it("starts with immediate horizontal movement", () => {
    expect(hopEaseOut(0)).toBe(0);
    expect(hopEaseOut(1)).toBe(1);
    expect(hopEaseOut(0.25)).toBeGreaterThan(0.25);
    expect(hopEaseOut(0.5)).toBe(0.75);
  });
});

describe("ids", () => {
  it("parses valid platform ids", () => {
    expect(parsePlatformId("3:4")).toEqual({ gridX: 3, gridY: 4 });
  });

  it("rejects malformed platform ids", () => {
    expect(parsePlatformId("3")).toBeNull();
    expect(parsePlatformId("3:4:5")).toBeNull();
    expect(parsePlatformId("a:b")).toBeNull();
    expect(parsePlatformId("3:-4")).toBeNull();
    expect(parsePlatformId("")).toBeNull();
  });
});
