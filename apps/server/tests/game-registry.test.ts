import { describe, expect, it } from "vitest";
import type { GameDefinition } from "../src/games/game-definition.js";
import { createGameRegistry } from "../src/games/game-registry.js";
import { testGameDefinition } from "./fixtures/test-game-room.js";

const secondDefinition: GameDefinition = {
  manifest: {
    id: "second-game",
    name: "Second Game",
    description: "Second game.",
    version: 1,
    minPlayers: 1,
    maxPlayers: 4,
    orientation: "any",
  },
  roomType: "second-room",
  roomClass: testGameDefinition.roomClass,
};

describe("game registry", () => {
  it("creates an empty registry", () => {
    const registry = createGameRegistry([]);
    expect(registry.listManifests()).toEqual([]);
    expect(registry.findById("anything")).toBeUndefined();
  });

  it("lists manifests and finds games by id", () => {
    const registry = createGameRegistry([testGameDefinition, secondDefinition]);
    expect(registry.listManifests()).toHaveLength(2);
    expect(registry.findById("second-game")?.manifest.name).toBe("Second Game");
    expect(registry.findById("missing")).toBeUndefined();
  });

  it("rejects duplicate game ids", () => {
    expect(() => createGameRegistry([testGameDefinition, testGameDefinition])).toThrow(
      "Duplicate game id",
    );
  });

  it("rejects duplicate room types", () => {
    const duplicateRoomType: GameDefinition = {
      manifest: {
        id: "different-game",
        name: "Different Game",
        description: "Different game.",
        version: 1,
        minPlayers: 1,
        maxPlayers: 4,
        orientation: "any",
      },
      roomType: testGameDefinition.roomType,
      roomClass: testGameDefinition.roomClass,
    };
    expect(() => createGameRegistry([testGameDefinition, duplicateRoomType])).toThrow(
      "Duplicate room type",
    );
  });

  it("rejects an invalid manifest", () => {
    const invalid: GameDefinition = {
      manifest: {
        id: "broken",
        name: "Broken",
        description: "Broken.",
        version: 0,
        minPlayers: 4,
        maxPlayers: 1,
        orientation: "any",
      },
      roomType: "broken-room",
      roomClass: testGameDefinition.roomClass,
    };
    expect(() => createGameRegistry([invalid])).toThrow();
  });

  it("does not expose mutable internal arrays", () => {
    const registry = createGameRegistry([testGameDefinition]);
    const first = registry.listDefinitions();
    const second = registry.listDefinitions();
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(registry.listManifests()).not.toBe(registry.listManifests());
  });

  it("returns copies of manifests", () => {
    const registry = createGameRegistry([testGameDefinition]);
    const manifests = registry.listManifests();
    const first = manifests[0];
    if (first === undefined) {
      throw new Error("Expected a manifest");
    }
    Object.assign(first, { name: "Mutated" });
    expect(registry.listManifests()[0]?.name).toBe("Test Platform Room");
  });
});
