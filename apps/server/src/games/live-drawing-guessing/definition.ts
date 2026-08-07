import { type GameManifest, LIVE_DRAWING_GUESSING_GAME_ID } from "@phone-party/protocol";

import type { GameDefinition } from "../game-definition.js";
import { LIVE_DRAWING_GUESSING_SERVER_CONSTANTS } from "./constants.js";
import { LiveDrawingGuessingRoom } from "./room.js";

export const LIVE_DRAWING_GUESSING_ROOM_TYPE = "live-drawing-guessing-room";

export const liveDrawingGuessingManifest: GameManifest = {
  id: LIVE_DRAWING_GUESSING_GAME_ID,
  name: "Live Drawing & Guessing",
  description:
    "One player draws a secret word while everyone else guesses it live. The first correct guess and the drawer each score a point.",
  version: 1,
  minPlayers: LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MIN_PLAYERS,
  maxPlayers: LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_PLAYERS,
  orientation: "portrait",
};

/**
 * Build the trusted Live Drawing and Guessing definition with a server-issued
 * room-creation token bound into the room class. The token is process-local
 * and shared with the lobby so only the platform can create game rooms, and
 * every seat reservation must carry the same token through onAuth.
 */
export function createLiveDrawingGuessingGameDefinition(roomCreationToken: string): GameDefinition {
  const roomClass = class extends LiveDrawingGuessingRoom {
    constructor() {
      super(roomCreationToken);
    }

    static override onAuth(token: string): Promise<unknown> {
      // Public Colyseus matchmaking must not reserve seats in a game room:
      // the Hono join route is the only boundary that can issue reservations
      // with the process-local token. This keeps mid-game spectator seats
      // server-controlled even though the room is unlocked while play runs.
      return Promise.resolve(token === roomCreationToken);
    }
  };
  return {
    manifest: liveDrawingGuessingManifest,
    roomType: LIVE_DRAWING_GUESSING_ROOM_TYPE,
    roomClass,
  };
}
