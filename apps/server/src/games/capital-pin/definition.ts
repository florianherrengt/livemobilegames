import { CAPITAL_PIN_GAME_ID, type GameManifest } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { CAPITAL_PIN_CONSTANTS } from "./constants.js";
import { CapitalPinRoom } from "./room.js";

export const CAPITAL_PIN_ROOM_TYPE = "capital-pin-room";

export const capitalPinManifest: GameManifest = {
  id: CAPITAL_PIN_GAME_ID,
  name: "Capital Pin",
  description: "Drop your pin where you think each capital city is. Closest guess wins the round.",
  version: 1,
  minPlayers: CAPITAL_PIN_CONSTANTS.MIN_PLAYERS,
  maxPlayers: CAPITAL_PIN_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Capital Pin definition with a server-issued room-creation
 * token bound into the room class. The token is process-local and shared with
 * the lobby so only the platform can create game rooms.
 */
export function createCapitalPinGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends CapitalPinRoom {
    constructor() {
      super(roomCreationToken);
    }
  };
  return {
    manifest: capitalPinManifest,
    roomType: CAPITAL_PIN_ROOM_TYPE,
    roomClass,
  };
}
