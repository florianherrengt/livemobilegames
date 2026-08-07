import {
  checkpointLine,
  crossesCheckpointBackward,
  crossesCheckpointForward,
  KART_RACING_TRACK,
  progressTowardNextGate,
} from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import {
  isInFallZone,
  isInSlowZone,
  isOnRoad,
  safeRespawnPoint,
  selectActiveCrates,
} from "../../../src/games/kart-racing/track.js";

describe("Kart Racing track geometry", () => {
  it("counts only forward crossings of the finish line on the road", () => {
    const line = checkpointLine(KART_RACING_TRACK, 0);
    expect(crossesCheckpointForward({ x: 249, y: 1050 }, { x: 251, y: 1050 }, line)).toBe(true);
    expect(crossesCheckpointBackward({ x: 249, y: 1050 }, { x: 251, y: 1050 }, line)).toBe(false);
    expect(crossesCheckpointBackward({ x: 251, y: 1050 }, { x: 249, y: 1050 }, line)).toBe(true);
    expect(crossesCheckpointForward({ x: 251, y: 1050 }, { x: 249, y: 1050 }, line)).toBe(false);
    // A crossing far above the road is not a valid checkpoint crossing.
    expect(crossesCheckpointForward({ x: 249, y: 600 }, { x: 251, y: 600 }, line)).toBe(false);
  });

  it("does not advance gate progress across the infield", () => {
    const infield = { x: 900, y: 650 };
    expect(isOnRoad(KART_RACING_TRACK, infield.x, infield.y)).toBe(false);
    expect(isInFallZone(KART_RACING_TRACK, infield.x, infield.y)).toBe(true);
    expect(progressTowardNextGate(KART_RACING_TRACK, infield, 0)).toBe(0);
  });

  it("selects well-spaced on-road crate spawns deterministically", () => {
    const crates = selectActiveCrates(KART_RACING_TRACK, "seed-123", 6);
    expect(crates).toHaveLength(6);
    for (const crate of crates) {
      expect(isOnRoad(KART_RACING_TRACK, crate.x, crate.y)).toBe(true);
      expect(isInFallZone(KART_RACING_TRACK, crate.x, crate.y)).toBe(false);
    }
    for (let i = 0; i < crates.length; i++) {
      for (let j = i + 1; j < crates.length; j++) {
        const a = crates[i];
        const b = crates[j];
        if (a && b) {
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(160);
        }
      }
    }
    expect(selectActiveCrates(KART_RACING_TRACK, "seed-123", 6).map((c) => c.id)).toEqual(
      crates.map((c) => c.id),
    );
  });

  it("finds a safe respawn point even when the preferred spot is occupied", () => {
    const respawn = safeRespawnPoint(KART_RACING_TRACK, 0, () => true);
    expect(isOnRoad(KART_RACING_TRACK, respawn.x, respawn.y, 4)).toBe(true);
    expect(isInFallZone(KART_RACING_TRACK, respawn.x, respawn.y)).toBe(false);
    expect(isInSlowZone(KART_RACING_TRACK, respawn.x, respawn.y)).toBe(false);
    expect(respawn.x).toBeGreaterThan(250);
  });
});
