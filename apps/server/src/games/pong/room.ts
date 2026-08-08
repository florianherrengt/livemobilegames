import { type Client, ErrorCode, Room, ServerError } from "@colyseus/core";
import {
  PONG_GAME_ID,
  PONG_MESSAGE_TYPES,
  PongState,
  pongCommandSchema,
  ROOM_MESSAGE_TYPES,
  seatOptionsSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";

import { PONG_SERVER_CONSTANTS } from "./constants.js";
import {
  addPlayer,
  applyPaddleIntent,
  buildSettings,
  createRuntime,
  finishByForfeit,
  hasConnectedPlayers,
  removePlayer,
  resetForNewMatch,
  startMatch,
  updatePong,
} from "./engine.js";
import { pongRoomOptionsSchema } from "./room-options.js";
import { syncPongState } from "./sync.js";
import type { PongRuntime } from "./types.js";

type RoomTimer = ReturnType<Room["clock"]["setTimeout"]>;

type RoomErrorCode =
  | "INVALID_REQUEST"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "GAME_ALREADY_STARTED"
  | "GAME_NOT_RUNNING"
  | "PLAYER_NOT_IN_ROOM"
  | "INVALID_GAME_COMMAND";

interface RosterPlayer {
  playerId: string;
  playerName: string;
  isHost: boolean;
  joinedOrder: number;
  connectedSessionId: string | null;
}

function sendError(client: Client, code: RoomErrorCode, message: string): void {
  client.send(ROOM_MESSAGE_TYPES.error, { code, message });
}

const paddleTimestamps = new WeakMap<PongRuntime, Map<string, number[]>>();

function consumePaddleRateLimit(runtime: PongRuntime, sessionId: string, now: number): boolean {
  let timestamps = paddleTimestamps.get(runtime);
  if (!timestamps) {
    timestamps = new Map();
    paddleTimestamps.set(runtime, timestamps);
  }
  const recent = (timestamps.get(sessionId) ?? []).filter((timestamp) => timestamp >= now - 1_000);
  if (recent.length >= PONG_SERVER_CONSTANTS.MAX_PADDLE_MESSAGES_PER_SECOND) {
    timestamps.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  timestamps.set(sessionId, recent);
  return true;
}

/**
 * Authoritative Four-Sided Pong Colyseus room. The lobby hands the room a
 * trusted roster through pongRoomOptionsSchema; each connected player arrives
 * with a server-issued seat reservation and is matched to the roster by
 * player id. The room owns timers, reconnection, phase transitions and the
 * synchronized projection; the engine owns the hidden rules.
 */
export class PongRoom extends Room<{ state: PongState }> {
  declare state: PongState;
  // Colyseus reserves a creator seat for the `matchMaker.create` call that
  // builds the room from the lobby. That reservation is never consumed by a
  // roster player, so the room needs one extra slot or an eight-player lobby
  // auto-locks before the last roster reservation is issued.
  override maxClients = PONG_SERVER_CONSTANTS.MAX_PLAYERS + 1;

  readonly #roomCreationToken: string;
  #engine!: PongRuntime;
  #roster: RosterPlayer[] = [];
  #transitionTimer: RoomTimer | null = null;
  #tickTimer: RoomTimer | null = null;

  constructor(roomCreationToken: string) {
    super();
    this.#roomCreationToken = roomCreationToken;
  }

  override onCreate(options: unknown): void {
    const parsed = pongRoomOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    // Only the platform lobby can create a Pong room: the public Colyseus
    // matchmaking endpoint must not forge a roster or test flags.
    if (parsed.data.roomCreationToken !== this.#roomCreationToken) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    this.#roster = [...parsed.data.players]
      .sort((a, b) => a.joinedOrder - b.joinedOrder)
      .map((player) => ({
        ...player,
        connectedSessionId: null,
      }));

    this.state = new PongState();
    this.state.roomCode = parsed.data.roomCode;
    this.state.gameId = PONG_GAME_ID;
    const e2eMode = parsed.data.e2eMode ?? false;
    // Unconsumed transition reservations block disposal until they expire.
    // Keep the window short in test mode so aborted transitions clean up fast.
    this.seatReservationTimeout = e2eMode ? 2 : 15;
    this.#engine = createRuntime(buildSettings({ e2eMode }));

    // The lobby disconnects itself shortly after issuing reservations. If any
    // roster player never arrives, this room cannot start and disposes itself
    // so the code mapping is released.
    this.#transitionTimer = this.clock.setTimeout(() => {
      if (this.#connectedRosterSize() < this.#roster.length) {
        void this.disconnect();
      }
    }, parsed.data.transitionTimeoutMs ?? PONG_SERVER_CONSTANTS.TRANSITION_TIMEOUT_MS);

    this.#tickTimer = this.clock.setInterval(
      () => this.#tick(),
      PONG_SERVER_CONSTANTS.SERVER_UPDATE_MS,
    );

    this.onMessage(PONG_MESSAGE_TYPES.paddleMove, (client, message: unknown) => {
      this.paddleIntent(client, message);
    });
    this.onMessage(PONG_MESSAGE_TYPES.paddleStop, (client, message: unknown) => {
      this.paddleIntent(client, message);
    });

    this.onMessage(ROOM_MESSAGE_TYPES.playAgain, (client, message: unknown) => {
      if (!startGameRequestSchema.safeParse(message).success) {
        sendError(client, "INVALID_REQUEST", "Malformed play-again request");
        return;
      }
      this.playAgain(client);
    });
  }

  override onJoin(client: Client, options: unknown): void {
    const parsed = seatOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid seat options");
    }
    const rosterPlayer = this.#roster.find((p) => p.playerId === parsed.data.playerId);
    if (!rosterPlayer || rosterPlayer.connectedSessionId !== null) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Room not joinable");
    }
    if (this.#engine.phase !== "lobby") {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Room not joinable");
    }

    rosterPlayer.connectedSessionId = client.sessionId;
    addPlayer(this.#engine, client.sessionId, rosterPlayer.playerName, rosterPlayer.joinedOrder);
    if (rosterPlayer.isHost) {
      this.state.hostSessionId = client.sessionId;
    }
    this.#sync();

    if (this.#connectedRosterSize() === this.#roster.length) {
      this.#clearTransitionTimer();
      this.#tryAutoStart();
    }
  }

  override onDrop(client: Client): void {
    const runtimePlayer = this.#engine.players.get(client.sessionId);
    if (!runtimePlayer) {
      return;
    }
    runtimePlayer.connected = false;
    runtimePlayer.queuedTarget = null;
    this.#sync();
    void this.allowReconnection(client, PONG_SERVER_CONSTANTS.RECONNECT_GRACE_MS / 1000).catch(
      () => {
        // Grace expired or the room is closing; onLeave finalises the removal.
      },
    );
  }

  override onReconnect(client: Client): void {
    const runtimePlayer = this.#engine.players.get(client.sessionId);
    if (!runtimePlayer) {
      return;
    }
    runtimePlayer.connected = true;
    this.#sync();
    this.#tryAutoStart();
  }

  override onLeave(client: Client): void {
    const runtimePlayer = this.#engine.players.get(client.sessionId);
    if (!runtimePlayer) {
      return;
    }
    const wasHost = client.sessionId === this.state.hostSessionId;
    this.#roster = this.#roster.filter(
      (rosterPlayer) => rosterPlayer.connectedSessionId !== client.sessionId,
    );
    for (const ball of this.#engine.balls.values()) {
      if (ball.ownerSessionId === client.sessionId) {
        ball.ownerSessionId = "";
      }
    }
    removePlayer(this.#engine, client.sessionId);
    if (wasHost) {
      this.#transferHost();
    }
    if (this.#engine.phase === "countdown" || this.#engine.phase === "running") {
      const connected = [...this.#engine.players.values()].filter((player) => player.connected);
      if (!hasConnectedPlayers(this.#engine)) {
        resetForNewMatch(this.#engine);
      } else if (connected.length === 1) {
        finishByForfeit(this.#engine, connected[0]?.sessionId ?? "");
      }
    }
    this.#sync();
    this.#tryAutoStart();
  }

  override onDispose(): void {
    this.#clearTransitionTimer();
    this.#clearTickTimer();
  }

  private paddleIntent(client: Client, message: unknown): void {
    const parsed = pongCommandSchema.safeParse(message);
    if (!parsed.success) {
      sendError(client, "INVALID_GAME_COMMAND", "Malformed game command");
      return;
    }
    const player = this.#engine.players.get(client.sessionId);
    if (!player) {
      sendError(client, "PLAYER_NOT_IN_ROOM", "You are not in this room");
      return;
    }
    const runtime = this.#engine;
    if (runtime.phase !== "countdown" && runtime.phase !== "running") {
      this.#rejectPaddle(client, parsed.data.sequence, "not-running");
      return;
    }
    if (!player.connected) {
      this.#rejectPaddle(client, parsed.data.sequence, "not-active");
      return;
    }
    if (
      player.seenSequences.has(parsed.data.sequence) ||
      parsed.data.sequence < player.lastAcceptedSequence - PONG_SERVER_CONSTANTS.SEQUENCE_WINDOW
    ) {
      this.#rejectPaddle(client, parsed.data.sequence, "stale-sequence");
      return;
    }
    if (!consumePaddleRateLimit(runtime, client.sessionId, Date.now())) {
      this.#rejectPaddle(client, parsed.data.sequence, "rate-limited");
      return;
    }

    const intent =
      parsed.data.type === "paddle_move"
        ? { type: "paddle_move" as const, target: parsed.data.target }
        : { type: "paddle_stop" as const };
    applyPaddleIntent(player, intent, parsed.data.sequence);
  }

  private playAgain(client: Client): void {
    if (client.sessionId !== this.state.hostSessionId) {
      sendError(client, "NOT_HOST", "Only the host can play again");
      return;
    }
    if (this.#engine.phase !== "finished") {
      sendError(client, "GAME_NOT_RUNNING", "Play again is only available after a match");
      return;
    }
    const connectedPlayers = [...this.#engine.players.values()].filter(
      (player) => player.connected,
    );
    if (connectedPlayers.length < PONG_SERVER_CONSTANTS.MIN_PLAYERS) {
      sendError(client, "NOT_ENOUGH_PLAYERS", "At least two connected players are required");
      return;
    }
    resetForNewMatch(this.#engine);
    this.#sync();
    this.#tryAutoStart();
  }

  #tick(): void {
    updatePong(this.#engine, Date.now());
    this.#sync();
  }

  /**
   * Start play automatically once every roster player is connected. This is
   * the single-start contract: the platform lobby's Start button transitions
   * everyone here, and the first countdown begins when the last player
   * arrives. It also restarts immediately after Play again when the whole
   * roster is present.
   */
  #tryAutoStart(): void {
    const runtime = this.#engine;
    if (runtime.phase !== "lobby") {
      return;
    }
    const connectedRosterSize = this.#connectedRosterSize();
    if (connectedRosterSize < PONG_SERVER_CONSTANTS.MIN_PLAYERS) {
      return;
    }
    if (connectedRosterSize !== this.#roster.length) {
      return;
    }
    if (startMatch(runtime, Date.now())) {
      this.#clearTransitionTimer();
      this.#sync();
    }
  }

  #sync(): void {
    syncPongState(this.state, this.#engine);
  }

  #transferHost(): void {
    const remaining = this.#roster
      .filter((rosterPlayer) => rosterPlayer.connectedSessionId !== null)
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    const next = remaining[0];
    this.state.hostSessionId = next?.connectedSessionId ?? "";
  }

  #connectedRosterSize(): number {
    return this.#roster.filter((player) => {
      if (player.connectedSessionId === null) {
        return false;
      }
      return this.#engine.players.get(player.connectedSessionId)?.connected === true;
    }).length;
  }

  #rejectPaddle(
    client: Client,
    sequence: number,
    reason: "not-running" | "not-active" | "stale-sequence" | "rate-limited",
  ): void {
    client.send(PONG_MESSAGE_TYPES.paddleRejected, {
      sequence,
      reason,
    });
  }

  #clearTransitionTimer(): void {
    this.#transitionTimer?.clear();
    this.#transitionTimer = null;
  }

  #clearTickTimer(): void {
    this.#tickTimer?.clear();
    this.#tickTimer = null;
  }
}
