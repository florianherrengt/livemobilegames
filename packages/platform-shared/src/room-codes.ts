import { customAlphabet } from "nanoid";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoomCodeGenerator(options: {
  alphabet?: string;
  length: number;
}): () => string {
  return customAlphabet(options.alphabet ?? ROOM_CODE_ALPHABET, options.length);
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}
