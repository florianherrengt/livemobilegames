import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "../src/rooms/room-code.js";

describe("room code utilities", () => {
  it("generates codes with exactly six allowed characters", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const char of code) {
        expect(ROOM_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("normalises input to uppercase", () => {
    expect(normalizeRoomCode(" abcdef ")).toBe("ABCDEF");
    expect(normalizeRoomCode("aB3dEf")).toBe("AB3DEF");
  });

  it("accepts valid codes", () => {
    expect(isValidRoomCode("ABCDEF")).toBe(true);
    expect(isValidRoomCode("234567")).toBe(true);
  });

  it("rejects ambiguous characters", () => {
    expect(isValidRoomCode("ABCOEF")).toBe(false);
    expect(isValidRoomCode("ABCIEF")).toBe(false);
    expect(isValidRoomCode("ABC0EF")).toBe(false);
    expect(isValidRoomCode("ABC1EF")).toBe(false);
  });

  it("rejects too-short and too-long codes", () => {
    expect(isValidRoomCode("ABCDE")).toBe(false);
    expect(isValidRoomCode("ABCDEFG")).toBe(false);
    expect(isValidRoomCode("")).toBe(false);
  });

  it("generates unique codes across a batch", () => {
    const codes = new Set<string>();
    for (let index = 0; index < 1_000; index += 1) {
      codes.add(generateRoomCode());
    }
    expect(codes.size).toBe(1_000);
  });
});
