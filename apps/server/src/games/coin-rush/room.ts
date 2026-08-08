import { type Client, ErrorCode, Room, ServerError } from "@colyseus/core";
import {
  COIN_RUSH_CONSTANTS,
  COIN_RUSH_GAME_ID,
  COIN_RUSH_MESSAGE_TYPES,
  CoinRushState,
  coinRushCommandSchema,
  ROOM_MESSAGE_TYPES,
  seatOptionsSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";

import { COIN_RUSH_SERVER_CONSTANTS } from "./constants.js";
import {
  addPlayer,
  createRuntime,
  removePlayer,
  resetForNewMatch,
  startMatch,
  updateRuntime,
} from "./engine.js";
import { isInsideBoard, targetPosition } from "./movement.js";
import { coinRushRoomOptionsSchema } from "./room-options.js";
import { buildSettings } from "./settings.js";
import { syncCoinRushState } from "./sync.js";
import type { CoinRushRuntime, RuntimePlayer } from "./types.js";

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

const moveTimestamps = new WeakMap<CoinRushRuntime, Map<string, number[]>>();

function consumeMoveRateLimit(runtime: CoinRushRuntime, sessionId: string, now: number): boolean {
  let timestamps = moveTimestamps.get(runtime);
  if (!timestamps) {
    timestamps = new Map();
    moveTimestamps.set(runtime, timestamps);
  }
  const recent = (timestamps.get(sessionId) ?? []).filter((timestamp) => timestamp >= now - 1000);
  if (recent.length >= runtime.settings.movesPerSecond) {
    timestamps.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  timestamps.set(sessionId, recent);
  return true;
}

/**
 * Authoritative Coin Rush Colyseus room. The lobby hands the room a trusted
 * roster through coinRushRoomOptionsSchema; each connected player arrives with
 * a server-issued seat reservation and is matched to the roster by player id.
 * The room owns timers, reconnection, phase transitions and the synchronized
 * projection; the engine owns the hidden rules.
 */
export class CoinRushRoom extends Room<{ state: CoinRushState }> {
  declare state: CoinRushState;
  // Colyseus reserves a creator seat for the `matchMaker.create` call that
  // builds the room from the lobby. That reservation is never consumed by a
  // roster player, so the room needs one extra slot or an eight-player lobby
  // auto-locks before the last roster reservation is issued.
  override maxClients = COIN_RUSH_SERVER_CONSTANTS.MAX_PLAYERS + 1;

  readonly #roomCreationToken: string;
  #engine!: CoinRushRuntime;
  #roster: RosterPlayer[] = [];
  #transitionTimer: RoomTimer | null = null;
  #tickTimer: RoomTimer | null = null;

  constructor(roomCreationToken: string) {
    super();
    this.#roomCreationToken = roomCreationToken;
  }

  override onCreate(options: unknown): void {
    const parsed = coinRushRoomOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    // Only the platform lobby can create a Coin Rush room: the public
    // Colyseus matchmaking endpoint must not forge a roster or test flags.
    if (parsed.data.roomCreationToken !== this.#roomCreationToken) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    this.#roster = [...parsed.data.players]
      .sort((a, b) => a.joinedOrder - b.joinedOrder)
      .map((player) => ({
        ...player,
        connectedSessionId: null,
      }));

    this.state = new CoinRushState();
    this.state.roomCode = parsed.data.roomCode;
    this.state.gameId = COIN_RUSH_GAME_ID;
    const e2eMode = parsed.data.e2eMode ?? false;
    // Unconsumed transition reservations block disposal until they expire.
    // Keep the window short in test mode so aborted transitions clean up fast.
    this.seatReservationTimeout = e2eMode ? 2 : 15;
    this.#engine = createRuntime(buildSettings(e2eMode));

    // The lobby disconnects itself shortly after issuing reservations. If any
    // roster player never arrives, this room cannot start and disposes itself
    // so the code mapping is released.
    this.#transitionTimer = this.clock.setTimeout(() => {
      if (this.#connectedRosterSize() < this.#roster.length) {
        void this.disconnect();
      }
    }, parsed.data.transitionTimeoutMs ?? COIN_RUSH_SERVER_CONSTANTS.TRANSITION_TIMEOUT_MS);

    this.#tickTimer = this.clock.setInterval(
      () => this.#tick(),
      COIN_RUSH_SERVER_CONSTANTS.SERVER_UPDATE_MS,
    );

    this.onMessage(COIN_RUSH_MESSAGE_TYPES.move, (client, message: unknown) => {
      this.move(client, message);
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
    const rosterPlayer = this.#roster.find((player) => player.playerId === parsed.data.playerId);
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
    runtimePlayer.alive = false;
    runtimePlayer.moving = false;
    this.#engine.pendingMoves.delete(client.sessionId);
    this.#sync();
    void this.allowReconnection(client, COIN_RUSH_SERVER_CONSTANTS.RECONNECT_GRACE_MS / 1000).catch(
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
    if (
      (this.#engine.phase === "countdown" || this.#engine.phase === "playing") &&
      !runtimePlayer.alive &&
      !runtimePlayer.respawning
    ) {
      runtimePlayer.respawning = true;
      runtimePlayer.respawnEndsAt = Date.now();
    }
    this.#sync();
    this.#tryAutoStart();
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    const wasHost = client.sessionId === this.state.hostSessionId;
    this.state.players.delete(client.sessionId);
    this.#roster = this.#roster.filter(
      (rosterPlayer) => rosterPlayer.connectedSessionId !== client.sessionId,
    );
    removePlayer(this.#engine, client.sessionId);
    if (wasHost) {
      this.#transferHost();
    }
    this.#sync();
    this.#tryAutoStart();
  }

  override onDispose(): void {
    this.#clearTransitionTimer();
    this.#clearTickTimer();
  }

  private move(client: Client, message: unknown): void {
    const parsed = coinRushCommandSchema.safeParse(message);
    if (!parsed.success) {
      sendError(client, "INVALID_GAME_COMMAND", "Malformed game command");
      return;
    }
    const player = this.#engine.players.get(client.sessionId);
    if (!player) {
      sendError(client, "PLAYER_NOT_IN_ROOM", "You are not in this room");
      return;
    }
    if (this.#engine.phase !== "playing") {
      this.#rejectMove(client, parsed.data.sequence, "not-playing");
      return;
    }
    if (!player.connected || !player.alive) {
      this.#rejectMove(client, parsed.data.sequence, "not-alive");
      return;
    }
    if (this.#engine.suddenDeath && !player.suddenDeathEligible) {
      this.#rejectMove(client, parsed.data.sequence, "not-eligible");
      return;
    }
    if (player.respawning) {
      this.#rejectMove(client, parsed.data.sequence, "respawning");
      return;
    }
    if (player.moving || this.#engine.pendingMoves.has(client.sessionId)) {
      this.#rejectMove(client, parsed.data.sequence, "already-moving");
      return;
    }
    if (
      player.seenSequences.has(parsed.data.sequence) ||
      parsed.data.sequence < player.lastAcceptedSequence - 64
    ) {
      this.#rejectMove(client, parsed.data.sequence, "stale-sequence");
      return;
    }
    if (!consumeMoveRateLimit(this.#engine, client.sessionId, Date.now())) {
      this.#rejectMove(client, parsed.data.sequence, "rate-limited");
      return;
    }
    const target = targetPosition(player, parsed.data.direction);
    if (!isInsideBoard(target, COIN_RUSH_CONSTANTS.COL_COUNT, COIN_RUSH_CONSTANTS.ROW_COUNT)) {
      this.#rejectMove(client, parsed.data.sequence, "out-of-bounds");
      return;
    }

    player.seenSequences.add(parsed.data.sequence);
    player.lastAcceptedSequence = Math.max(player.lastAcceptedSequence, parsed.data.sequence);
    for (const sequence of [...player.seenSequences]) {
      if (sequence < player.lastAcceptedSequence - 64) {
        player.seenSequences.delete(sequence);
      }
    }
    this.#engine.pendingMoves.set(client.sessionId, {
      sequence: parsed.data.sequence,
      direction: parsed.data.direction,
    });
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
    resetForNewMatch(this.#engine);
    this.#sync();
    this.#tryAutoStart();
  }

  #tick(): void {
    const now = Date.now();
    updateRuntime(this.#engine, now);
    this.#sync();
  }

  /**
   * Start play automatically once every roster player is connected. This is
   * the single-start contract: the platform lobby's Start button transitions
   * everyone here, and round 1 begins when the last player arrives. It also
   * restarts immediately after Play again when the whole roster is present.
   */
  #tryAutoStart(): void {
    if (this.#engine.phase !== "lobby") {
      return;
    }
    const connectedRosterSize = this.#connectedRosterSize();
    if (connectedRosterSize < COIN_RUSH_SERVER_CONSTANTS.MIN_PLAYERS) {
      return;
    }
    if (connectedRosterSize !== this.#roster.length) {
      return;
    }
    if (startMatch(this.#engine, Date.now())) {
      this.#clearTransitionTimer();
      this.#sync();
    }
  }

  #sync(): void {
    syncCoinRushState(this.state, this.#engine);
  }

  #transferHost(): void {
    const remaining = this.#roster
      .filter((rosterPlayer) => rosterPlayer.connectedSessionId !== null)
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    const next = remaining[0];
    this.state.hostSessionId = next?.connectedSessionId ?? "";
  }

  #connectedRosterSize(): number {
    return this.#roster.filter((rosterPlayer) => {
      if (rosterPlayer.connectedSessionId === null) {
        return false;
      }
      return this.#engine.players.get(rosterPlayer.connectedSessionId)?.connected === true;
    }).length;
  }

  #rejectMove(
    client: Client,
    sequence: number,
    reason:
      | "not-playing"
      | "not-alive"
      | "not-eligible"
      | "respawning"
      | "already-moving"
      | "out-of-bounds"
      | "stale-sequence"
      | "rate-limited",
  ): void {
    client.send(COIN_RUSH_MESSAGE_TYPES.moveRejected, { sequence, reason });
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

export type { RuntimePlayer };
