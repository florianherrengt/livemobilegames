import { normalizeRoomCode } from "@phone-party/protocol";

import { generateRoomCode } from "./room-code.js";

export type RoomDirectoryEntry = {
  readonly roomId: string;
  readonly gameId: string | null;
};

const EMPTY_ENTRY: Readonly<RoomDirectoryEntry> = Object.freeze({
  roomId: "",
  gameId: null,
});
const MAX_CODE_ATTEMPTS = 100;

export class RoomDirectory {
  // This Map is the only mutable room-code state in the process. It stays
  // encapsulated so callers cannot corrupt code uniqueness or live mappings.
  readonly #entries = new Map<string, RoomDirectoryEntry>();

  reserveCode(): string {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = generateRoomCode();
      if (!this.#entries.has(code)) {
        this.#entries.set(code, EMPTY_ENTRY);
        return code;
      }
    }
    throw new Error("Unable to reserve a unique room code");
  }

  setEntry(code: string, entry: RoomDirectoryEntry): void {
    // Store a copy so external callers cannot mutate the directory through a
    // previously returned entry object.
    this.#entries.set(normalizeRoomCode(code), { ...entry });
  }

  getByCode(code: string): RoomDirectoryEntry | undefined {
    const entry = this.#entries.get(normalizeRoomCode(code));
    return entry !== undefined && entry.roomId !== "" ? { ...entry } : undefined;
  }

  deleteByCode(code: string): boolean {
    return this.#entries.delete(normalizeRoomCode(code));
  }

  /**
   * Delete an entry only when it still maps to the given room id. Used by
   * disposal cleanup so a lobby that disposes after handing its code to a game
   * room cannot remove the game room's live mapping.
   */
  deleteByCodeIfMatchingRoom(code: string, roomId: string): boolean {
    const normalized = normalizeRoomCode(code);
    const entry = this.#entries.get(normalized);
    if (entry === undefined || entry.roomId !== roomId) {
      return false;
    }
    return this.#entries.delete(normalized);
  }

  hasCode(code: string): boolean {
    return this.#entries.has(normalizeRoomCode(code));
  }

  size(): number {
    return this.#entries.size;
  }
}
