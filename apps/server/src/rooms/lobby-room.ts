import { type Client, ErrorCode, Room, type RoomOptions, ServerError } from "@colyseus/core";
import {
  LobbyPlayerState,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  resumeTransitionRequestSchema,
  roomOptionsSchema,
  seatOptionsSchema,
  selectGameRequestSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";

import type { GameRegistry } from "../games/game-registry.js";
import type { Logger } from "../logging.js";
import type { GameTransitionResult, TransitionPlayer } from "./game-transition.js";

export const LOBBY_ROOM_TYPE = "__platform_lobby";
const LOBBY_RECONNECT_GRACE_SECONDS = 10;

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
  readonly e2eTurnDurationMs: number | undefined;
  readonly transitionTimeoutMs: number;
  readonly roomCreationToken: string;
  readonly logger: Logger;
  readonly startGameTransition: (input: {
    roomCode: string;
    gameId: string;
    players: readonly TransitionPlayer[];
    e2eMode: boolean;
    e2eTurnDurationMs: number | undefined;
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
    private readonly connectedSessionIds = new Set<string>();
    private pendingTransition:
      | {
          readonly gameId: string;
          readonly reservations: GameTransitionResult["reservations"];
        }
      | undefined;

    static override onAuth(token: string): Promise<unknown> {
      // Lobby matchmaking is an internal boundary: browsers receive completed
      // reservations from the Hono API and never create or reserve rooms
      // directly. Requiring the process-local token prevents public Colyseus
      // matchmaking from forging trusted room and seat options.
      return Promise.resolve(token === deps.roomCreationToken);
    }

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
        if (this.transitioning) {
          client.error(ErrorCode.APPLICATION_ERROR, "The game is already starting");
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
        const connected = players.filter((player) =>
          this.connectedSessionIds.has(player.sessionId),
        );
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
        // Explicitly lock before the first asynchronous transition step. A
        // concurrent HTTP join must not receive a lobby reservation that can
        // only fail later because the trusted game roster is already frozen.
        void this.lock()
          .then(() =>
            deps.startGameTransition({
              roomCode: this.state.roomCode,
              gameId,
              players: connected,
              e2eMode: deps.e2eMode,
              e2eTurnDurationMs: deps.e2eTurnDurationMs,
              transitionTimeoutMs: deps.transitionTimeoutMs,
              roomCreationToken: deps.roomCreationToken,
            }),
          )
          .then((result) => {
            this.pendingTransition = { gameId, reservations: result.reservations };
            for (const sessionId of result.reservations.keys()) {
              const transitionClient = this.clients.getById(sessionId);
              if (transitionClient !== undefined) {
                this.sendPendingTransition(transitionClient);
              }
            }
            // Keep the lobby's reconnect path alive for the same bounded
            // window as the game transition. A client that drops after Start
            // can reconnect and explicitly request its already-issued seat.
            this.clock.setTimeout(
              () => {
                void this.disconnect();
              },
              Math.max(deps.transitionTimeoutMs, LOBBY_RECONNECT_GRACE_SECONDS * 1_000) + 1_000,
            );
          })
          .catch(async (error: unknown) => {
            this.transitioning = false;
            this.pendingTransition = undefined;
            await this.unlock().catch((unlockError: unknown) => {
              deps.logger.error(
                { err: unlockError, gameId, roomCode: this.state.roomCode },
                "lobby unlock after failed transition failed",
              );
            });
            deps.logger.error(
              { err: error, gameId, roomCode: this.state.roomCode },
              "game transition failed",
            );
            sendLobbyError(client, "INTERNAL_ERROR", "Could not start the game");
          });
      });

      this.onMessage(ROOM_MESSAGE_TYPES.resumeTransition, (client, message: unknown) => {
        const parsedResume = resumeTransitionRequestSchema.safeParse(message);
        if (!parsedResume.success) {
          sendLobbyError(client, "INVALID_REQUEST", "Malformed transition resume request");
          return;
        }
        this.sendPendingTransition(client);
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
      for (const player of this.state.players.values()) {
        if (player.playerId === parsed.data.playerId) {
          throw new ServerError(ErrorCode.APPLICATION_ERROR, "Player already joined");
        }
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
      this.connectedSessionIds.add(client.sessionId);
    }

    override onDrop(client: Client): void {
      if (!this.state.players.has(client.sessionId)) {
        return;
      }
      this.connectedSessionIds.delete(client.sessionId);
      void this.allowReconnection(client, LOBBY_RECONNECT_GRACE_SECONDS).catch(() => {
        // Grace expired or the room is closing; onLeave finalises removal and
        // host transfer.
      });
    }

    override onReconnect(client: Client): void {
      if (this.state.players.has(client.sessionId)) {
        this.connectedSessionIds.add(client.sessionId);
      }
    }

    override onLeave(client: Client): void {
      this.connectedSessionIds.delete(client.sessionId);
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

    private sendPendingTransition(client: Client): void {
      const pending = this.pendingTransition;
      const reservation = pending?.reservations.get(client.sessionId);
      if (pending === undefined || reservation === undefined) {
        return;
      }
      client.send(ROOM_MESSAGE_TYPES.transition, {
        gameId: pending.gameId,
        roomCode: this.state.roomCode,
        reservation,
      });
    }
  };
}

function sendLobbyError(client: Client, code: LobbyErrorCode, message: string): void {
  client.send(ROOM_MESSAGE_TYPES.error, { code, message });
}
