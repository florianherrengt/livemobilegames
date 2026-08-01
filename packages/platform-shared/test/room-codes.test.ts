import {
  createRoomCodeGenerator,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
} from "@falling-platforms/platform-shared";
import { describe, expect, it } from "vitest";

describe("room code generator", () => {
  it("generates codes with the requested length", () => {
    const generate = createRoomCodeGenerator({ length: 6 });
    for (let index = 0; index < 20; index++) {
      expect(generate()).toHaveLength(6);
    }
  });

  it("only uses the allowed alphabet", () => {
    const generate = createRoomCodeGenerator({ length: 20 });
    for (let index = 0; index < 20; index++) {
      const code = generate();
      for (const char of code) {
        expect(ROOM_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("supports a custom alphabet", () => {
    const generate = createRoomCodeGenerator({ alphabet: "ABC", length: 4 });
    expect(generate()).toMatch(/^[ABC]{4}$/);
  });

  it("normalises user input before lookup", () => {
    expect(normalizeRoomCode("  abcde ")).toBe("ABCDE");
  });
});
