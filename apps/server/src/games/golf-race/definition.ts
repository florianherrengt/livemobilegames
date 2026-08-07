import { type GameManifest, GOLF_GAME_ID } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { GOLF_SERVER_CONSTANTS } from "./constants.js";
import { GolfRaceRoom } from "./room.js";

export const GOLF_ROOM_TYPE = "golf-race-room";

export const golfRaceManifest: GameManifest = {
  id: GOLF_GAME_ID,
  name: "Golf Race",
  description:
    "Five rounds of golf shots through one shared course. Hazards grow each round; most points after round 5 wins.",
  version: 1,
  minPlayers: GOLF_SERVER_CONSTANTS.MIN_PLAYERS,
  maxPlayers: GOLF_SERVER_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Golf definition with a server-issued room-creation token
 * bound into the room class. The token is process-local and shared with the
 * lobby so only the platform can create game rooms.
 */
export function createGolfRaceGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends GolfRaceRoom {
    constructor() {
      super(roomCreationToken);
    }
  };
  return {
    manifest: golfRaceManifest,
    roomType: GOLF_ROOM_TYPE,
    roomClass,
  };
}
