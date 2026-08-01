import { describe, expect, it } from "vitest";
import { CAPITALS } from "../src/capitals.js";
import { validateCapitalDataset } from "../src/validation.js";

describe("validateCapitalDataset", () => {
  it("accepts the bundled dataset", () => {
    expect(() => validateCapitalDataset(CAPITALS)).not.toThrow();
  });

  it("has at least 120 capitals", () => {
    expect(CAPITALS.length).toBeGreaterThanOrEqual(120);
  });

  it("rejects a duplicate id", () => {
    const bad = [
      { id: "x", city: "A", country: "AA", latitude: 0, longitude: 0 },
      { id: "x", city: "B", country: "BB", latitude: 1, longitude: 1 },
    ];
    // pad to >=120 by reusing unique ids with distinct city/country
    const padded = [...bad];
    for (let i = 2; i < 122; i++) {
      padded.push({ id: `y${i}`, city: `C${i}`, country: `D${i}`, latitude: 0, longitude: 0 });
    }
    expect(() => validateCapitalDataset(padded)).toThrow(/Duplicate capital id/);
  });

  it("rejects an out-of-range latitude", () => {
    const bad = [{ id: "x", city: "A", country: "AA", latitude: 95, longitude: 0 }];
    expect(() => validateCapitalDataset(bad)).toThrow();
  });

  it("rejects an out-of-range longitude", () => {
    const bad = [{ id: "x", city: "A", country: "AA", latitude: 0, longitude: 200 }];
    expect(() => validateCapitalDataset(bad)).toThrow();
  });

  it("rejects an empty city", () => {
    const bad = [{ id: "x", city: "", country: "AA", latitude: 0, longitude: 0 }];
    expect(() => validateCapitalDataset(bad)).toThrow();
  });

  it("rejects a duplicate city/country pair", () => {
    const padded = [
      { id: "a", city: "X", country: "Y", latitude: 0, longitude: 0 },
      { id: "b", city: "x", country: "y", latitude: 1, longitude: 1 }, // case-insensitive dup
    ];
    for (let i = 2; i < 122; i++) {
      padded.push({ id: `c${i}`, city: `U${i}`, country: `V${i}`, latitude: 0, longitude: 0 });
    }
    expect(() => validateCapitalDataset(padded)).toThrow(/Duplicate capital city\/country pair/);
  });
});
