import { FALLING_PLATFORMS_GAME_ID, type GameManifest } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { FALLING_PLATFORMS_SERVER_CONSTANTS } from "./constants.js";
import { FallingPlatformsRoom } from "./room.js";

export const FALLING_PLATFORMS_ROOM_TYPE = "falling-platforms-room";

export const fallingPlatformsManifest: GameManifest = {
  id: FALLING_PLATFORMS_GAME_ID,
  name: "Falling Platforms",
  description: "Hop across platforms as the arena collapses under you. Last survivor wins.",
  version: 1,
  minPlayers: FALLING_PLATFORMS_SERVER_CONSTANTS.MIN_PLAYERS,
  maxPlayers: FALLING_PLATFORMS_SERVER_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Falling Platforms definition with a server-issued
 * room-creation token bound into the room class. The token is process-local
 * and shared with the lobby so only the platform can create game rooms.
 */
export function createFallingPlatformsGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends FallingPlatformsRoom {
    constructor() {
      super(roomCreationToken);
    }
  };
  return {
    manifest: fallingPlatformsManifest,
    roomType: FALLING_PLATFORMS_ROOM_TYPE,
    roomClass,
  };
}
