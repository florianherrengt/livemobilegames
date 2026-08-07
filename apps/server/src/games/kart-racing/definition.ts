import { type GameManifest, KART_RACING_GAME_ID } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { KART_RACING_SERVER_CONSTANTS } from "./constants.js";
import { KartRacingRoom } from "./room.js";

export const KART_RACING_ROOM_TYPE = "kart-racing-room";

export const kartRacingManifest: GameManifest = {
  id: KART_RACING_GAME_ID,
  name: "Kart Racing",
  description:
    "Top-down arcade kart races. Steer with one finger, swipe up to shoot, and be first over the line in three races.",
  version: 1,
  minPlayers: KART_RACING_SERVER_CONSTANTS.MIN_PLAYERS,
  maxPlayers: KART_RACING_SERVER_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Kart Racing definition with a server-issued room-creation
 * token bound into the room class. The token is process-local and shared with
 * the lobby so only the platform can create game rooms.
 */
export function createKartRacingGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends KartRacingRoom {
    constructor() {
      super(roomCreationToken);
    }
  };
  return {
    manifest: kartRacingManifest,
    roomType: KART_RACING_ROOM_TYPE,
    roomClass,
  };
}
