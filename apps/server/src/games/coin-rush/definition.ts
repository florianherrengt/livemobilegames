import { COIN_RUSH_GAME_ID, type GameManifest } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { COIN_RUSH_SERVER_CONSTANTS } from "./constants.js";
import { CoinRushRoom } from "./room.js";

export const COIN_RUSH_ROOM_TYPE = "coin-rush-room";

export const coinRushManifest: GameManifest = {
  id: COIN_RUSH_GAME_ID,
  name: "Coin Rush",
  description:
    "Swipe across shared roads to grab coins and push rivals. First to ten points wins each round; three rounds decide the match.",
  version: 1,
  minPlayers: COIN_RUSH_SERVER_CONSTANTS.MIN_PLAYERS,
  maxPlayers: COIN_RUSH_SERVER_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Coin Rush definition with a server-issued room-creation
 * token bound into the room class. The token is process-local and shared with
 * the lobby so only the platform can create game rooms.
 */
export function createCoinRushGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends CoinRushRoom {
    constructor() {
      super(roomCreationToken);
    }
  };
  return {
    manifest: coinRushManifest,
    roomType: COIN_RUSH_ROOM_TYPE,
    roomClass,
  };
}
