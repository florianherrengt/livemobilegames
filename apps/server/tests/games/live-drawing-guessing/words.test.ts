import { describe, expect, it } from "vitest";

import {
  buildLetterPattern,
  letterCount,
  WORD_CATEGORIES,
  WORD_POOL,
} from "../../../src/games/live-drawing-guessing/words.js";

describe("word pool quality", () => {
  it("contains only canonical, drawable, 4-12 letter words", () => {
    const seen = new Set<string>();
    for (const entry of WORD_POOL) {
      expect(seen.has(entry.word)).toBe(false);
      seen.add(entry.word);
      const letters = entry.word.replace(/[^A-Za-z]/g, "");
      expect(letters.length).toBeGreaterThanOrEqual(4);
      expect(letters.length).toBeLessThanOrEqual(12);
      expect(entry.word).toMatch(/^[A-Za-z]+(?: [A-Za-z]+)*$/);
      expect(WORD_CATEGORIES).toContain(entry.category);
    }
  });

  it("keeps the pool large enough for a full eight-player match", () => {
    expect(WORD_POOL.length).toBeGreaterThanOrEqual(8 * 3 * 3);
  });

  it("avoids words with common aliases, regional variants, and ambiguous names", () => {
    const blocked = new Set([
      "sofa",
      "couch",
      "mobile phone",
      "phone",
      "cell phone",
      "aeroplane",
      "airplane",
      "chips",
      "fries",
      "cookie",
      "biscuit",
      "lorry",
      "keyboard",
      "wizard",
      "motorbike",
      "soda",
      "pop",
      "sweets",
      "candy",
    ]);
    for (const entry of WORD_POOL) {
      expect(blocked.has(entry.word)).toBe(false);
    }
  });
});

describe("letter pattern helpers", () => {
  it("counts only alphabetical letters", () => {
    expect(letterCount("giraffe")).toBe(7);
    expect(letterCount("ice cream")).toBe(8);
    expect(letterCount("swimming pool")).toBe(12);
  });

  it("hides every letter and shows spaces immediately", () => {
    expect(buildLetterPattern("ICE CREAM")).toEqual(["_", "_", "_", " ", "_", "_", "_", "_", "_"]);
  });

  it("reveals only the requested positions, independently for repeated letters", () => {
    expect(buildLetterPattern("BANANA", [1])).toEqual(["_", "A", "_", "_", "_", "_"]);
    expect(buildLetterPattern("BANANA", [3])).toEqual(["_", "_", "_", "A", "_", "_"]);
  });
});
