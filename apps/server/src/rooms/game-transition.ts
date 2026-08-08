import { matchMaker } from "@colyseus/core";
import type { ISeatReservation } from "@phone-party/protocol";

import type { GameRegistry } from "../games/game-registry.js";
import { attachDirectoryCleanup } from "./directory-cleanup.js";
import type { RoomDirectory } from "./room-directory.js";

export interface TransitionPlayer {
  sessionId: string;
  playerId: string;
  playerName: string;
  isHost: boolean;
  joinedOrder: number;
}

export interface GameTransitionResult {
  gameRoomId: string;
  reservations: Map<string, ISeatReservation>;
}

/**
 * Create the registered game room for a lobby, reserve one seat for every
 * connected player, and repoint the room-code directory at the game room.
 *
 * The game room is created with the lobby's trusted roster; each player then
 * receives their own reservation over the socket. If any step fails, the
 * created game room is disconnected and the directory is left pointing at the
 * still-live lobby.
 */
export async function startGameTransition(
  directory: RoomDirectory,
  registry: GameRegistry,
  input: {
    roomCode: string;
    gameId: string;
    players: readonly TransitionPlayer[];
    e2eMode: boolean;
    e2eTurnDurationMs: number | undefined;
    transitionTimeoutMs: number;
    roomCreationToken: string;
  },
): Promise<GameTransitionResult> {
  const definition = registry.findById(input.gameId);
  if (!definition) {
    throw new Error(`Game not registered: ${input.gameId}`);
  }

  const createReservation = await matchMaker.create(
    definition.roomType,
    {
      roomCode: input.roomCode,
      players: input.players.map((player) => ({
        playerId: player.playerId,
        playerName: player.playerName,
        isHost: player.isHost,
        joinedOrder: player.joinedOrder,
      })),
      e2eMode: input.e2eMode,
      e2eTurnDurationMs: input.e2eTurnDurationMs,
      transitionTimeoutMs: input.transitionTimeoutMs,
      roomCreationToken: input.roomCreationToken,
    },
    {
      token: input.roomCreationToken,
      headers: new Headers(),
      ip: "internal",
    },
  );
  try {
    const reservations = new Map<string, ISeatReservation>();
    for (const player of input.players) {
      const reservation = await matchMaker.joinById(
        createReservation.roomId,
        {
          playerId: player.playerId,
          playerName: player.playerName,
        },
        {
          // Game rooms may define onAuth (the Live Drawing room does, to keep
          // mid-game spectator seats server-issued). Roster joins are
          // process-internal and must carry the same capability token the
          // HTTP room service uses.
          token: input.roomCreationToken,
          headers: new Headers(),
          ip: "internal",
        },
      );
      reservations.set(player.sessionId, reservation);
    }

    const gameRoom = matchMaker.getLocalRoomById(createReservation.roomId);
    if (!gameRoom) {
      // matchMaker.create resolves only after the room is registered locally.
      // Failing loudly here prevents a silently unlocked room and a directory
      // mapping with no disposal cleanup.
      throw new Error("Created game room is not registered");
    }
    // Lock after every roster reservation exists: the room must reject new
    // HTTP joins, while already-issued reservations remain consumable.
    await gameRoom.lock();
    directory.setEntry(input.roomCode, {
      roomId: createReservation.roomId,
      gameId: input.gameId,
    });
    attachDirectoryCleanup(gameRoom, directory, input.roomCode);
    return { gameRoomId: createReservation.roomId, reservations };
  } catch (error) {
    const gameRoom = matchMaker.getLocalRoomById(createReservation.roomId);
    if (gameRoom) {
      await gameRoom.disconnect();
    }
    throw error;
  }
}
