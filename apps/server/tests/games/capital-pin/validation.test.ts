import { describe, expect, it } from "vitest";

import { CAPITALS } from "../../../src/games/capital-pin/capitals.js";
import { validateCapitalDataset } from "../../../src/games/capital-pin/validation.js";

describe("capital dataset validation", () => {
  it("accepts the bundled dataset", () => {
    expect(() => validateCapitalDataset(CAPITALS)).not.toThrow();
  });

  it("uses the official capitals for Benin and Ivory Coast", () => {
    expect(CAPITALS).toContainEqual(
      expect.objectContaining({ city: "Porto-Novo", country: "Benin" }),
    );
    expect(CAPITALS).toContainEqual(
      expect.objectContaining({ city: "Yamoussoukro", country: "Ivory Coast" }),
    );
    expect(CAPITALS).not.toContainEqual(expect.objectContaining({ city: "Cotonou" }));
    expect(CAPITALS).not.toContainEqual(expect.objectContaining({ city: "Abidjan" }));
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

  it("rejects datasets with fewer than 120 entries", () => {
    expect(() => validateCapitalDataset(CAPITALS.slice(0, 10))).toThrow("at least 120 entries");
  });
});
