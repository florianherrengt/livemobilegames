import { describe, expect, it } from "vitest";

import { RoomDirectory } from "../src/rooms/room-directory.js";

describe("room directory", () => {
  it("reserves unique codes", () => {
    const directory = new RoomDirectory();
    const codes = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const code = directory.reserveCode();
      expect(directory.hasCode(code)).toBe(true);
      codes.add(code);
    }
    expect(codes.size).toBe(500);
  });

  it("sets, reads and deletes entries", () => {
    const directory = new RoomDirectory();
    const code = directory.reserveCode();
    expect(directory.getByCode(code)).toBeUndefined();

    directory.setEntry(code, { roomId: "room-1", gameId: "game-1" });
    expect(directory.getByCode(code)).toEqual({ roomId: "room-1", gameId: "game-1" });
    expect(directory.getByCode(code.toLowerCase())).toEqual({
      roomId: "room-1",
      gameId: "game-1",
    });

    expect(directory.deleteByCode(code)).toBe(true);
    expect(directory.getByCode(code)).toBeUndefined();
    expect(directory.size()).toBe(0);
  });

  it("tracks reserved placeholders as occupied", () => {
    const directory = new RoomDirectory();
    const code = directory.reserveCode();
    expect(directory.hasCode(code)).toBe(true);
    expect(directory.size()).toBe(1);
    expect(directory.getByCode(code)).toBeUndefined();
  });

  it("does not expose its internal map", () => {
    const directory = new RoomDirectory();
    directory.reserveCode();
    expect(Object.getOwnPropertyNames(directory)).not.toContain("entries");
  });

  it("returns copies of entries", () => {
    const directory = new RoomDirectory();
    const code = directory.reserveCode();
    directory.setEntry(code, { roomId: "room-1", gameId: "game-1" });
    const first = directory.getByCode(code);
    if (first === undefined) {
      throw new Error("Expected an entry");
    }
    Object.assign(first, { roomId: "mutated" });
    expect(directory.getByCode(code)?.roomId).toBe("room-1");
  });
});
