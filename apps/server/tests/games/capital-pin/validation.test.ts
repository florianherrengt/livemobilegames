import { describe, expect, it } from "vitest";

import { CAPITALS } from "../../../src/games/capital-pin/capitals.js";
import { CAPITAL_PIN_CONSTANTS } from "../../../src/games/capital-pin/constants.js";
import { validateCapitalDataset } from "../../../src/games/capital-pin/validation.js";

describe("capital dataset validation", () => {
  it("accepts the bundled dataset", () => {
    expect(() => validateCapitalDataset(CAPITALS)).not.toThrow();
  });

  it("keeps a curated pool of 50 familiar national capitals", () => {
    expect(CAPITALS).toHaveLength(50);
    expect(CAPITALS.map((capital) => capital.city)).toEqual(
      expect.arrayContaining([
        "Paris",
        "London",
        "Rome",
        "Madrid",
        "Berlin",
        "Lisbon",
        "Amsterdam",
        "Brussels",
        "Vienna",
        "Athens",
        "Moscow",
        "Washington, D.C.",
        "Tokyo",
        "Beijing",
        "New Delhi",
        "Cairo",
        "Ottawa",
        "Mexico City",
        "Bangkok",
        "Buenos Aires",
      ]),
    );
  });

  it("excludes regional administrative centres and districts without a capital city", () => {
    expect(CAPITALS).not.toContainEqual(expect.objectContaining({ city: "Cayenne" }));
    expect(CAPITALS).not.toContainEqual(expect.objectContaining({ city: "Yaren" }));
  });

  it("rejects malformed entries", () => {
    expect(() =>
      validateCapitalDataset([{ id: "x", city: "X", country: "Y", latitude: 200, longitude: 0 }]),
    ).toThrow("Invalid capital entry");
  });

  it("rejects duplicate ids", () => {
    const capital = CAPITALS[0];
    if (!capital) throw new Error("dataset is empty");
    expect(() => validateCapitalDataset([capital, capital])).toThrow("Duplicate capital id");
  });

  it("rejects duplicate city/country pairs", () => {
    const first = CAPITALS[0];
    const second = CAPITALS[1];
    if (!first || !second) throw new Error("dataset is too small");
    expect(() =>
      validateCapitalDataset([
        { ...first, id: "a" },
        { ...second, id: "b", city: first.city, country: first.country },
      ]),
    ).toThrow("Duplicate capital city/country pair");
  });

  it("requires enough unique capitals for a complete match", () => {
    const roundCount = CAPITAL_PIN_CONSTANTS.TOTAL_ROUNDS;
    expect(() => validateCapitalDataset(CAPITALS.slice(0, roundCount))).not.toThrow();
    expect(() => validateCapitalDataset(CAPITALS.slice(0, roundCount - 1))).toThrow(
      `at least ${roundCount} entries`,
    );
  });
});
