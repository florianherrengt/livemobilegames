import { randomInt } from "node:crypto";
import {
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  roomCodeSchema,
} from "@phone-party/protocol";

export { normalizeRoomCode };

export function isValidRoomCode(input: string): boolean {
  return roomCodeSchema.safeParse(normalizeRoomCode(input)).success;
}

export function generateRoomCode(): string {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
  }
  return code;
}
