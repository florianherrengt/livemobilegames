import { type GameManifest, PONG_GAME_ID } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { PONG_SERVER_CONSTANTS } from "./constants.js";
import { PongRoom } from "./room.js";

export const PONG_ROOM_TYPE = "pong-room";

export const pongManifest: GameManifest = {
  id: PONG_GAME_ID,
  name: "Four-Sided Pong",
  description:
    "Defend your edge, return the balls, and score when another player misses a ball you last touched.",
  version: 1,
  minPlayers: PONG_SERVER_CONSTANTS.MIN_PLAYERS,
  maxPlayers: PONG_SERVER_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Pong definition with a server-issued room-creation token
 * bound into the room class. The token is process-local and shared with the
 * lobby so only the platform can create game rooms.
 */
export function createPongGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends PongRoom {
    constructor() {
      super(roomCreationToken);
    }
  };
  return {
    manifest: pongManifest,
    roomType: PONG_ROOM_TYPE,
    roomClass,
  };
}
