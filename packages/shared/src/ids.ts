import { customAlphabet } from "nanoid";

import { ROOM_CODE_LENGTH } from "./constants.js";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const generateRoomCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function platformId(gridX: number, gridY: number): string {
  return `${gridX}:${gridY}`;
}

export type PlatformIdParts = {
  gridX: number;
  gridY: number;
};

/**
 * Parses a platform id of the form "gridX:gridY". Returns null for anything
 * malformed or non-numeric.
 */
export function parsePlatformId(id: string): PlatformIdParts | null {
  const match = /^(\d+):(\d+)$/.exec(id);
  if (!match) {
    return null;
  }
  return {
    gridX: Number.parseInt(match[1] ?? "0", 10),
    gridY: Number.parseInt(match[2] ?? "0", 10),
  };
}
