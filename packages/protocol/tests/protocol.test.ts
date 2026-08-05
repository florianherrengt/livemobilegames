import { describe, expect, it } from "vitest";

import {
  createRoomRequestSchema,
  gameManifestSchema,
  normalizeRoomCode,
  roomCodeSchema,
  selectGameRequestSchema,
} from "../src/index.js";

describe("game manifest schema", () => {
  it("accepts a valid manifest", () => {
    const result = gameManifestSchema.safeParse({
      id: "avoid-the-laser",
      name: "Avoid the Laser",
      description: "Dodge lasers on your phone.",
      version: 1,
      minPlayers: 2,
      maxPlayers: 8,
      orientation: "portrait",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a manifest where maxPlayers is below minPlayers", () => {
    const result = gameManifestSchema.safeParse({
      id: "broken",
      name: "Broken",
      description: "Broken manifest.",
      version: 1,
      minPlayers: 4,
      maxPlayers: 2,
      orientation: "any",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["maxPlayers"]);
    }
  });
});

describe("room code schema", () => {
  it("normalises lowercase codes to uppercase", () => {
    expect(normalizeRoomCode(" abcdef ")).toBe("ABCDEF");
  });

  it("rejects ambiguous characters", () => {
    expect(roomCodeSchema.safeParse("ABC0EF").success).toBe(false);
    expect(roomCodeSchema.safeParse("ABC1EF").success).toBe(false);
    expect(roomCodeSchema.safeParse("ABCOEF").success).toBe(false);
    expect(roomCodeSchema.safeParse("ABCIEF").success).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(roomCodeSchema.safeParse("ABCDE").success).toBe(false);
    expect(roomCodeSchema.safeParse("ABCDEFG").success).toBe(false);
  });
});

describe("create room request schema", () => {
  it("accepts a valid request", () => {
    const result = createRoomRequestSchema.safeParse({
      playerName: "Alice",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ playerName: "Alice" });
    }
  });

  it("rejects an empty player name", () => {
    const result = createRoomRequestSchema.safeParse({
      playerName: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("validates game selection ids", () => {
    const valid = selectGameRequestSchema.safeParse({ gameId: "avoid-the-laser" });
    const invalid = selectGameRequestSchema.safeParse({ gameId: "Invalid_Game" });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});
