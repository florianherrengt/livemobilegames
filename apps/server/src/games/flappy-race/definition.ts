import { FLAPPY_RACE_GAME_ID, type GameManifest } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { FLAPPY_RACE_SERVER_CONSTANTS } from "./constants.js";
import { FlappyRaceRoom } from "./room.js";

export const FLAPPY_RACE_ROOM_TYPE = "flappy-race-room";

export const flappyRaceManifest: GameManifest = {
  id: FLAPPY_RACE_GAME_ID,
  name: "Flappy Race",
  description:
    "Tap to flap through shared obstacle courses. Furthest bird wins each round; five rounds decide the match.",
  version: 1,
  minPlayers: FLAPPY_RACE_SERVER_CONSTANTS.MIN_PLAYERS,
  maxPlayers: FLAPPY_RACE_SERVER_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Flappy Race definition with a server-issued room-creation
 * token bound into the room class. The token is process-local and shared with
 * the lobby so only the platform can create game rooms.
 */
export function createFlappyRaceGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends FlappyRaceRoom {
    constructor() {
      super(roomCreationToken);
    }
  };
  return {
    manifest: flappyRaceManifest,
    roomType: FLAPPY_RACE_ROOM_TYPE,
    roomClass,
  };
}
