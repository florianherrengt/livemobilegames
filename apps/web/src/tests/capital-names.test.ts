import { describe, expect, it } from "vitest";

import { getCapitalCityDisplayName } from "../games/capital-pin/capital-names.js";

describe("getCapitalCityDisplayName", () => {
  it.each(["fr", "fr-FR", "fr-CA"])('uses French city names for locale "%s"', (locale) => {
    expect(getCapitalCityDisplayName("Vienna", locale)).toBe("Vienne");
  });

  it("keeps the original city for other locales and unknown French names", () => {
    expect(getCapitalCityDisplayName("Vienna", "en-GB")).toBe("Vienna");
    expect(getCapitalCityDisplayName("Unlisted City", "fr-FR")).toBe("Unlisted City");
  });

  it("keeps shared forms and applies French diacritics", () => {
    expect(getCapitalCityDisplayName("Paris", "fr-FR")).toBe("Paris");
    expect(getCapitalCityDisplayName("Hanoi", "fr-FR")).toBe("Hanoï");
  });

  it.each([
    ["San Marino", "Saint-Marin"],
    ["Guatemala City", "Guatémala"],
    ["Panama City", "Panama"],
    ["Santo Domingo", "Saint-Domingue"],
    ["Abu Dhabi", "Abou Dhabi"],
    ["South Tarawa", "Tarawa-Sud"],
    ["Dhaka", "Dacca"],
    ["Thimphu", "Thimphou"],
    ["Antananarivo", "Tananarive"],
  ])("uses the reference French form for %s", (city, frenchName) => {
    expect(getCapitalCityDisplayName(city, "fr-FR")).toBe(frenchName);
  });
});
