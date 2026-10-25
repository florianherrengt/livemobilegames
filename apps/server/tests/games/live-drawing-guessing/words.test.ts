import { describe, expect, it } from "vitest";

import {
  buildLetterPattern,
  FRENCH_WORD_CATEGORIES,
  FRENCH_WORD_POOL,
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

  it("contains a broad French pool with valid NFC words and localized categories", () => {
    expect(FRENCH_WORD_POOL.length).toBeGreaterThanOrEqual(72);
    const seen = new Set<string>();
    for (const entry of FRENCH_WORD_POOL) {
      expect(entry.word).toBe(entry.word.normalize("NFC"));
      expect(seen.has(entry.word)).toBe(false);
      seen.add(entry.word);
      expect(letterCount(entry.word)).toBeGreaterThanOrEqual(4);
      expect(letterCount(entry.word)).toBeLessThanOrEqual(12);
      expect(entry.word).toMatch(/^[\p{L}]+(?:[ '-][\p{L}]+)*$/u);
      expect(FRENCH_WORD_CATEGORIES).toContain(entry.category);
    }
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
    expect(letterCount("éléphant")).toBe(8);
  });

  it("hides every letter and shows spaces immediately", () => {
    expect(buildLetterPattern("ICE CREAM")).toEqual(["_", "_", "_", " ", "_", "_", "_", "_", "_"]);
  });

  it("reveals only the requested positions, independently for repeated letters", () => {
    expect(buildLetterPattern("BANANA", [1])).toEqual(["_", "A", "_", "_", "_", "_"]);
    expect(buildLetterPattern("BANANA", [3])).toEqual(["_", "_", "_", "A", "_", "_"]);
  });

  it("hides accented letters and reveals their original spelling", () => {
    expect(buildLetterPattern("éléphant")).toEqual(["_", "_", "_", "_", "_", "_", "_", "_"]);
    expect(buildLetterPattern("éléphant", [0, 1])).toEqual([
      "É",
      "L",
      "_",
      "_",
      "_",
      "_",
      "_",
      "_",
    ]);
  });
});
