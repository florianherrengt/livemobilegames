import {
  LobbyPlayerState,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  roomOptionsSchema,
  seatOptionsSchema,
  selectGameRequestSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";
import { type Client, ErrorCode, Room, type RoomOptions, ServerError } from "colyseus";

import type { GameRegistry } from "../games/game-registry.js";
import type { Logger } from "../logging.js";
import type { GameTransitionResult, TransitionPlayer } from "./game-transition.js";

export const LOBBY_ROOM_TYPE = "__platform_lobby";

type LobbyErrorCode =
  | "INVALID_REQUEST"
  | "GAME_ALREADY_STARTED"
  | "ROOM_FULL"
  | "NOT_HOST"
  | "GAME_NOT_RUNNING"
  | "NOT_ENOUGH_PLAYERS"
  | "INTERNAL_ERROR";

export type LobbyRoomDeps = {
  readonly registry: GameRegistry;
  readonly e2eMode: boolean;
  readonly transitionTimeoutMs: number;
  readonly roomCreationToken: string;
  readonly logger: Logger;
  readonly startGameTransition: (input: {
    roomCode: string;
    gameId: string;
    players: readonly TransitionPlayer[];
    e2eMode: boolean;
    transitionTimeoutMs: number;
    roomCreationToken: string;
  }) => Promise<GameTransitionResult>;
};

export function createLobbyRoomClass(
  deps: LobbyRoomDeps,
): new (
  ...args: unknown[]
) => Room<RoomOptions> {
  // A factory is used instead of a global registry so each platform server owns
  // its registry and tests can inject a test registry without shared state.
  return class PlatformLobbyRoom extends Room<{ state: LobbyRoomState }> {
    declare state: LobbyRoomState;
    override maxClients = 8;
    private transitioning = false;

    override onCreate(options: unknown): void {
      const parsed = roomOptionsSchema.safeParse(options);
      if (!parsed.success) {
        throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
      }
      this.maxClients = parsed.data.maxClients ?? 8;
      this.state = new LobbyRoomState();
      this.state.roomCode = parsed.data.roomCode;

      this.onMessage("select_game", (client, message: unknown) => {
        const selected = selectGameRequestSchema.safeParse(message);
        if (!selected.success) {
          client.error(ErrorCode.APPLICATION_ERROR, "Invalid game selection");
          return;
        }
        if (client.sessionId !== this.state.hostSessionId) {
          client.error(ErrorCode.APPLICATION_ERROR, "Only the host can choose a game");
          return;
        }
        const game = deps.registry.findById(selected.data.gameId);
        if (game === undefined) {
          client.error(ErrorCode.APPLICATION_ERROR, "Game not found");
          return;
        }
        this.state.gameId = game.manifest.id;
      });

      this.onMessage(ROOM_MESSAGE_TYPES.startGame, (client, message: unknown) => {
        const parsedStart = startGameRequestSchema.safeParse(message);
        if (!parsedStart.success) {
          sendLobbyError(client, "INVALID_REQUEST", "Malformed start request");
          return;
        }
        if (this.transitioning) {
          sendLobbyError(client, "GAME_ALREADY_STARTED", "The game is already starting");
          return;
        }
        if (client.sessionId !== this.state.hostSessionId) {
          sendLobbyError(client, "NOT_HOST", "Only the host can start the game");
          return;
        }
        const gameId = this.state.gameId;
        if (!gameId) {
          sendLobbyError(client, "GAME_NOT_RUNNING", "Choose a game before starting");
          return;
        }
        const definition = deps.registry.findById(gameId);
        if (!definition) {
          sendLobbyError(client, "GAME_NOT_RUNNING", "The selected game is no longer available");
          return;
        }
        const players: TransitionPlayer[] = [...this.state.players.entries()].map(
          ([sessionId, player], joinedOrder) => ({
            sessionId,
            playerId: player.playerId,
            playerName: player.name,
            isHost: player.isHost,
            joinedOrder,
          }),
        );
        const connected = players.filter((player) => this.clients.getById(player.sessionId));
        if (connected.length < definition.manifest.minPlayers) {
          sendLobbyError(
            client,
            "NOT_ENOUGH_PLAYERS",
            `At least ${definition.manifest.minPlayers} connected players are required`,
          );
          return;
        }
        if (connected.length > definition.manifest.maxPlayers) {
          sendLobbyError(
            client,
            "ROOM_FULL",
            `This game supports up to ${definition.manifest.maxPlayers} players`,
          );
          return;
        }

        this.transitioning = true;
        void deps
          .startGameTransition({
            roomCode: this.state.roomCode,
            gameId,
            players: connected,
            e2eMode: deps.e2eMode,
            transitionTimeoutMs: deps.transitionTimeoutMs,
            roomCreationToken: deps.roomCreationToken,
          })
          .then((result) => {
            for (const [sessionId, reservation] of result.reservations) {
              this.clients.getById(sessionId)?.send(ROOM_MESSAGE_TYPES.transition, {
                gameId,
                roomCode: this.state.roomCode,
                reservation,
              });
            }
            // Let the queued transition messages flush, then close the lobby.
            // The room-code mapping already points at the game room.
            this.clock.setTimeout(() => {
              void this.disconnect();
            }, 2_000);
          })
          .catch((error: unknown) => {
            this.transitioning = false;
            deps.logger.error(
              { err: error, gameId, roomCode: this.state.roomCode },
              "game transition failed",
            );
            sendLobbyError(client, "INTERNAL_ERROR", "Could not start the game");
          });
      });
    }

    override onJoin(client: Client, options: unknown): void {
      const parsed = seatOptionsSchema.safeParse(options);
      if (!parsed.success) {
        throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid join options");
      }
      if (this.transitioning) {
        throw new ServerError(ErrorCode.APPLICATION_ERROR, "Room not joinable");
      }
      const isHost = this.state.players.size === 0;
      if (isHost) {
        this.state.hostSessionId = client.sessionId;
      }
      const player = new LobbyPlayerState();
      player.playerId = parsed.data.playerId;
      player.name = parsed.data.playerName;
      player.isHost = isHost;
      this.state.players.set(client.sessionId, player);
    }

    override onLeave(client: Client): void {
      this.state.players.delete(client.sessionId);
      if (client.sessionId === this.state.hostSessionId) {
        const nextHost = this.state.players.keys().next().value;
        if (nextHost === undefined) {
          this.state.hostSessionId = "";
        } else {
          this.state.hostSessionId = nextHost;
          const player = this.state.players.get(nextHost);
          if (player !== undefined) {
            player.isHost = true;
          }
        }
      }
    }
  };
}

function sendLobbyError(client: Client, code: LobbyErrorCode, message: string): void {
  client.send(ROOM_MESSAGE_TYPES.error, { code, message });
}
