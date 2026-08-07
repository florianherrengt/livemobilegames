import { COIN_RUSH_CONSTANTS } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import { generateRows } from "../../../src/games/coin-rush/map.js";

describe("Coin Rush map generation", () => {
  it("generates the same map for the same seed", () => {
    const first = generateRows("unit-seed", false);
    const second = generateRows("unit-seed", false);
    expect(first).toEqual(second);
  });

  it("keeps the bottom two rows safe and the upper area fully dangerous", () => {
    const rows = generateRows("unit-seed", false);
    expect(rows[0]?.terrain).toBe("safe");
    expect(rows[1]?.terrain).toBe("safe");
    for (let row = 12; row < COIN_RUSH_CONSTANTS.ROW_COUNT; row++) {
      expect(rows[row]?.terrain).toBe("road");
    }
  });

  it("uses alternating directions on consecutive upper roads", () => {
    const rows = generateRows("unit-seed", false);
    let previousDirection: -1 | 1 | undefined;
    for (let row = 12; row < COIN_RUSH_CONSTANTS.ROW_COUNT; row++) {
      const runtimeRow = rows[row];
      if (runtimeRow?.terrain !== "road") {
        continue;
      }
      if (previousDirection !== undefined) {
        expect(runtimeRow.direction).toBe(previousDirection === 1 ? -1 : 1);
      }
      previousDirection = runtimeRow.direction === 0 ? undefined : runtimeRow.direction;
    }
  });

  it("makes the upper traffic faster and denser than the lower traffic", () => {
    const rows = generateRows("unit-seed", false);
    const lowerRoads = rows.filter((row) => row.terrain === "road" && row.row >= 2 && row.row <= 6);
    const middleRoads = rows.filter(
      (row) => row.terrain === "road" && row.row >= 7 && row.row <= 11,
    );
    const upperRoads = rows.filter((row) => row.terrain === "road" && row.row >= 12);
    expect(lowerRoads.length).toBeGreaterThan(0);
    expect(middleRoads.length).toBeGreaterThanOrEqual(3);
    expect(upperRoads.length).toBe(5);
    const averageUpperSpeed =
      upperRoads.reduce((sum, row) => sum + row.speed, 0) / upperRoads.length;
    const averageUpperGap =
      upperRoads.reduce((sum, row) => sum + (row.spacing - row.vehicleLength), 0) /
      upperRoads.length;
    const averageLowerSpeed =
      lowerRoads.reduce((sum, row) => sum + row.speed, 0) / lowerRoads.length;
    expect(averageUpperSpeed).toBeGreaterThan(averageLowerSpeed);
    for (const row of upperRoads) {
      expect(row.spacing - row.vehicleLength).toBeGreaterThanOrEqual(2);
      expect(row.spacing - row.vehicleLength).toBeLessThan(averageUpperGap + 2);
    }
  });

  it("keeps guaranteed danger in the lower and middle areas across many seeds", () => {
    for (let seedIndex = 0; seedIndex < 50; seedIndex++) {
      const rows = generateRows(`difficulty-${seedIndex}`, false);
      const lowerRoads = rows.filter(
        (row) => row.terrain === "road" && row.row >= 2 && row.row <= 6,
      );
      const middleRoads = rows.filter(
        (row) => row.terrain === "road" && row.row >= 7 && row.row <= 11,
      );
      const upperRoads = rows.filter((row) => row.terrain === "road" && row.row >= 12);
      expect(lowerRoads.length).toBeGreaterThanOrEqual(1);
      expect(middleRoads.length).toBeGreaterThanOrEqual(3);
      expect(upperRoads.length).toBe(5);
    }
  });
});
