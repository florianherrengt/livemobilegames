import { describe, expect, it } from "vitest";

import {
  KART_RACING_CONSTANTS,
  KART_RACING_MESSAGE_TYPES,
  KART_RACING_TRACK,
  KartRacingState,
  kartRacingCommandSchema,
  kartShootCommandSchema,
  kartSteerCommandSchema,
  nearestRoadPoint,
  progressTowardNextGate,
} from "../src/index.js";

describe("Kart Racing protocol", () => {
  it("parses valid steer and shoot commands", () => {
    expect(
      kartSteerCommandSchema.parse({ type: "steer", sequence: 1, raceNumber: 1, steering: 0.5 }),
    ).toEqual({
      type: "steer",
      sequence: 1,
      raceNumber: 1,
      steering: 0.5,
    });
    expect(kartShootCommandSchema.parse({ type: "shoot", sequence: 2, raceNumber: 2 })).toEqual({
      type: "shoot",
      sequence: 2,
      raceNumber: 2,
    });
    expect(
      kartRacingCommandSchema.parse({ type: "steer", sequence: 1, raceNumber: 1, steering: -1 }),
    ).toHaveProperty("type", "steer");
  });

  it("rejects malformed, out-of-bounds, and smuggled command fields", () => {
    expect(
      kartSteerCommandSchema.safeParse({ type: "steer", sequence: 0, raceNumber: 1, steering: 0 })
        .success,
    ).toBe(false);
    expect(
      kartSteerCommandSchema.safeParse({ type: "steer", sequence: 1, raceNumber: 1, steering: 2 })
        .success,
    ).toBe(false);
    expect(
      kartSteerCommandSchema.safeParse({
        type: "steer",
        sequence: 1,
        raceNumber: 1,
        steering: 0,
        playerId: "forged",
        x: 999,
      }).success,
    ).toBe(false);
    expect(
      kartShootCommandSchema.safeParse({ type: "shoot", sequence: 1, raceNumber: 1, winner: true })
        .success,
    ).toBe(false);
  });

  it("initializes synchronized state with safe defaults", () => {
    const state = new KartRacingState();
    expect(state.phase).toBe("lobby");
    expect(state.raceNumber).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.crates.length).toBe(0);
    expect(state.projectiles.length).toBe(0);
    expect(state.raceResult.length).toBe(0);
    expect(state.result).toBeNull();
  });

  it("keeps shared tuning values in one central table", () => {
    expect(KART_RACING_CONSTANTS.MAX_SPEED).toBeGreaterThan(0);
    expect(KART_RACING_CONSTANTS.LAPS_PER_RACE).toBe(3);
    expect(KART_RACING_CONSTANTS.RACES_PER_MATCH).toBe(3);
    expect(KART_RACING_CONSTANTS.SWIPE_DISTANCE_PX).toBeGreaterThanOrEqual(50);
    expect(KART_RACING_CONSTANTS.SWIPE_TIME_MS).toBeLessThanOrEqual(300);
    expect(KART_RACING_CONSTANTS.SWIPE_VERTICAL_RATIO).toBeGreaterThanOrEqual(2);
    expect(KART_RACING_MESSAGE_TYPES.steer).toBe("game:steer");
    expect(KART_RACING_MESSAGE_TYPES.shoot).toBe("game:shoot");
  });

  it("defines a closed circuit whose grid, crates, and checkpoints are on the road", () => {
    const track = KART_RACING_TRACK;
    expect(track.centerline.length).toBeGreaterThanOrEqual(8);
    expect(track.checkpointIndexes).toHaveLength(5);
    expect(track.gridPositions).toHaveLength(8);
    for (const position of track.gridPositions) {
      expect(nearestRoadPoint(track, position).distance).toBeLessThanOrEqual(track.roadHalfWidth);
    }
    for (const crate of track.crateSpawnPoints) {
      expect(nearestRoadPoint(track, crate).distance).toBeLessThanOrEqual(track.roadHalfWidth - 20);
    }
    for (const checkpoint of track.checkpointIndexes) {
      expect(checkpoint).toBeGreaterThan(0);
      expect(checkpoint).toBeLessThan(track.centerline.length);
    }
  });

  it("computes gate progress from the last passed checkpoint", () => {
    const track = KART_RACING_TRACK;
    const nearStart = progressTowardNextGate(track, { x: 350, y: 1050 }, 0);
    const atFirstCheckpoint = progressTowardNextGate(track, { x: 1450, y: 980 }, 0);
    expect(nearStart).toBeGreaterThan(0);
    expect(atFirstCheckpoint).toBeGreaterThan(nearStart);
    expect(progressTowardNextGate(track, { x: 1000, y: 600 }, 0)).toBe(0);
  });
});
