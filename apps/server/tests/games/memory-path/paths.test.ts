import { describe, expect, it } from "vitest";

import {
  PATH_TEMPLATES,
  pathWidthForDifficulty,
  ROUTES_BY_DIFFICULTY,
  routeForDifficulty,
  validatePathTemplate,
} from "../../../src/games/memory-path/paths.js";
import { createSeededRng } from "../../../src/games/memory-path/runtime.js";

describe("Memory Path route data", () => {
  it("provides at least eight easy, eight medium, and eight hard routes", () => {
    expect(ROUTES_BY_DIFFICULTY.easy.length).toBeGreaterThanOrEqual(8);
    expect(ROUTES_BY_DIFFICULTY.medium.length).toBeGreaterThanOrEqual(8);
    expect(ROUTES_BY_DIFFICULTY.hard.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every curated route valid under the route validation rules", () => {
    for (const route of PATH_TEMPLATES) {
      expect(() => validatePathTemplate(route)).not.toThrow();
    }
  });

  it("narrows the corridor as difficulty increases", () => {
    expect(pathWidthForDifficulty("easy")).toBeGreaterThan(pathWidthForDifficulty("medium"));
    expect(pathWidthForDifficulty("medium")).toBeGreaterThan(pathWidthForDifficulty("hard"));
  });

  it("selects deterministically for a fixed seed and never repeats used routes", () => {
    const used = new Set<string>();
    const first = routeForDifficulty("easy", used, createSeededRng("unit-seed"));
    used.add(first.id);
    const second = routeForDifficulty("easy", used, createSeededRng("unit-seed"));
    expect(second.id).not.toBe(first.id);

    const replayUsed = new Set<string>();
    const replayFirst = routeForDifficulty("easy", replayUsed, createSeededRng("unit-seed"));
    replayUsed.add(replayFirst.id);
    const replaySecond = routeForDifficulty("easy", replayUsed, createSeededRng("unit-seed"));
    expect(replayFirst.id).toBe(first.id);
    expect(replaySecond.id).toBe(second.id);
  });

  it("fails clearly when the difficulty pool is exhausted", () => {
    const used = new Set(ROUTES_BY_DIFFICULTY.hard.map((route) => route.id));
    expect(() => routeForDifficulty("hard", used, createSeededRng("unit-seed"))).toThrow(
      /No unused hard route available/,
    );
  });

  it("rejects invalid route data instead of silently accepting it", () => {
    const crossing = {
      id: "invalid-crossing",
      difficulty: "easy" as const,
      points: [
        { x: 195, y: 700 },
        { x: 100, y: 400 },
        { x: 100, y: 300 },
        { x: 300, y: 300 },
        { x: 300, y: 700 },
        { x: 100, y: 700 },
        { x: 100, y: 140 },
        { x: 195, y: 140 },
      ],
    };
    expect(() => validatePathTemplate(crossing)).toThrow(/crosses itself/);
  });
});
