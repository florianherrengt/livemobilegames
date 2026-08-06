import { describe, expect, it } from "vitest";

import {
  arenaOriginX,
  arenaOriginY,
  clamp,
  computeArenaSide,
  easeInOut,
  FALLING_PLATFORMS_CONSTANTS,
  FallingPlatformPlatformState,
  FallingPlatformsPlayerState,
  FallingPlatformsState,
  fallingPlatformHopRejectionSchema,
  fallingPlatformHopSchema,
  fallingPlatformsCommandSchema,
  hopEaseOut,
  isAdjacent,
  lerp,
  parsePlatformId,
  platformCenterX,
  platformCenterY,
  platformId,
} from "../src/index.js";

describe("falling platforms hop command", () => {
  it("accepts a valid hop intent", () => {
    const result = fallingPlatformHopSchema.safeParse({
      type: "hop",
      sequence: 7,
      targetPlatformId: "3:4",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed sequences and platform ids", () => {
    const invalid = [
      { type: "hop", sequence: 1.5, targetPlatformId: "3:4" },
      { type: "hop", sequence: Number.NaN, targetPlatformId: "3:4" },
      { type: "hop", sequence: 1, targetPlatformId: "banana" },
      { type: "hop", sequence: 1, targetPlatformId: "3:4:5" },
      { type: "hop", sequence: 1, targetPlatformId: "999" },
    ];
    for (const payload of invalid) {
      expect(fallingPlatformHopSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("rejects unknown fields, identity, and claimed outcomes", () => {
    const result = fallingPlatformHopSchema.safeParse({
      type: "hop",
      sequence: 1,
      targetPlatformId: "3:4",
      sessionId: "forged-session",
      currentPlatformId: "3:3",
      landed: true,
    });
    expect(result.success).toBe(false);
  });

  it("discriminates the command union by type", () => {
    expect(fallingPlatformsCommandSchema.safeParse({ type: "unknown" }).success).toBe(false);
    expect(
      fallingPlatformsCommandSchema.safeParse({
        type: "hop",
        sequence: 2,
        targetPlatformId: "4:4",
      }).success,
    ).toBe(true);
  });
});

describe("hop rejection payload", () => {
  it("accepts a stable sequence and reason", () => {
    expect(
      fallingPlatformHopRejectionSchema.safeParse({ sequence: 3, reason: "target-gone" }).success,
    ).toBe(true);
  });

  it("rejects unknown reasons and extra fields", () => {
    expect(
      fallingPlatformHopRejectionSchema.safeParse({ sequence: 3, reason: "forged" }).success,
    ).toBe(false);
    expect(
      fallingPlatformHopRejectionSchema.safeParse({
        sequence: 3,
        reason: "target-gone",
        winner: true,
      }).success,
    ).toBe(false);
  });
});

describe("platform id helpers", () => {
  it("builds and parses platform ids", () => {
    expect(platformId(3, 4)).toBe("3:4");
    expect(parsePlatformId("3:4")).toEqual({ gridX: 3, gridY: 4 });
    expect(parsePlatformId("banana")).toBeNull();
    expect(parsePlatformId("3:4:5")).toBeNull();
  });

  it("accepts orthogonal and diagonal adjacency only", () => {
    expect(isAdjacent(3, 3, 3, 4)).toBe(true);
    expect(isAdjacent(3, 3, 4, 4)).toBe(true);
    expect(isAdjacent(3, 3, 3, 3)).toBe(false);
    expect(isAdjacent(3, 3, 3, 5)).toBe(false);
  });
});

describe("arena math", () => {
  it("grows the arena with player count and keeps an odd side", () => {
    expect(computeArenaSide(2)).toBe(5);
    expect(computeArenaSide(3)).toBe(5);
    expect(computeArenaSide(4)).toBe(5);
    expect(computeArenaSide(5)).toBe(7);
    expect(computeArenaSide(8)).toBe(7);
    expect(computeArenaSide(12)).toBe(9);
  });

  it("centres the arena origin on zero", () => {
    const side = computeArenaSide(2);
    expect(arenaOriginX(side)).toBe((-side * FALLING_PLATFORMS_CONSTANTS.TILE_PITCH) / 2);
    expect(arenaOriginY(side)).toBe(arenaOriginX(side));
    expect(platformCenterX(0, side)).toBe(
      arenaOriginX(side) + FALLING_PLATFORMS_CONSTANTS.TILE_PITCH / 2,
    );
    expect(platformCenterY(0, side)).toBe(
      arenaOriginY(side) + FALLING_PLATFORMS_CONSTANTS.TILE_PITCH / 2,
    );
  });
});

describe("easing helpers", () => {
  it("clamps, lerps, and eases deterministically", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(hopEaseOut(0)).toBe(0);
    expect(hopEaseOut(1)).toBe(1);
  });
});

describe("falling platforms synchronized state", () => {
  it("initialises with safe public defaults", () => {
    const state = new FallingPlatformsState();
    expect(state.gameId).toBe("");
    expect(state.roomCode).toBe("");
    expect(state.hostSessionId).toBe("");
    expect(state.phase).toBe("lobby");
    expect(state.winnerSessionId).toBe("");
    expect(state.draw).toBe(false);
    expect(state.roundNumber).toBe(0);
    expect(state.aliveCount).toBe(0);
    expect(state.arenaSide).toBe(0);
    expect(state.matchStartedAt).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.platforms.size).toBe(0);
    expect("seed" in state).toBe(false);
  });

  it("initialises player and platform rows with safe defaults", () => {
    const player = new FallingPlatformsPlayerState();
    expect(player.connected).toBe(true);
    expect(player.participating).toBe(false);
    expect(player.alive).toBe(false);
    expect(player.jumping).toBe(false);
    expect(player.currentPlatformId).toBe("");
    expect(player.lastAcceptedSequence).toBe(0);

    const platform = new FallingPlatformPlatformState();
    expect(platform.state).toBe("stable");
    expect(platform.gridX).toBe(0);
    expect(platform.gridY).toBe(0);
  });
});
