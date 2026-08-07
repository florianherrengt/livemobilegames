import { type GameManifest, MEMORY_PATH_GAME_ID } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { MEMORY_PATH_SERVER_CONSTANTS } from "./constants.js";
import { MemoryPathRoom } from "./room.js";

export const MEMORY_PATH_ROOM_TYPE = "memory-path-room";

export const memoryPathManifest: GameManifest = {
  id: MEMORY_PATH_GAME_ID,
  name: "Memory Path",
  description:
    "Memorize the route, race from memory, and do not step off the hidden path. Three rounds decide the match.",
  version: 1,
  minPlayers: MEMORY_PATH_SERVER_CONSTANTS.MIN_PLAYERS,
  maxPlayers: MEMORY_PATH_SERVER_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Memory Path definition with a server-issued room-creation
 * token bound into the room class. The token is process-local and shared with
 * the lobby so only the platform can create game rooms.
 */
export function createMemoryPathGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends MemoryPathRoom {
    constructor() {
      super(roomCreationToken);
    }
  };
  return {
    manifest: memoryPathManifest,
    roomType: MEMORY_PATH_ROOM_TYPE,
    roomClass,
  };
}
