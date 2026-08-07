import {
  MEMORY_PATH_GAME_ID,
  MEMORY_PATH_MESSAGE_TYPES,
  MemoryPathState,
  memoryPathCommandSchema,
  ROOM_MESSAGE_TYPES,
  seatOptionsSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";
import { type Client, ErrorCode, Room, ServerError } from "colyseus";

import { MEMORY_PATH_SERVER_CONSTANTS } from "./constants.js";
import { evaluateNoEligible, updateRuntime } from "./engine.js";
import { memoryPathRoomOptionsSchema } from "./room-options.js";
import {
  createRuntime,
  createRuntimePlayer,
  createSettings,
  resetForNewMatch,
  startMatch,
} from "./runtime.js";
import { syncMemoryPathState } from "./sync.js";
import type { MemoryPathRuntime } from "./types.js";

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

const moveTimestamps = new WeakMap<MemoryPathRuntime, Map<string, number[]>>();

function consumeMoveRateLimit(runtime: MemoryPathRuntime, sessionId: string, now: number): boolean {
  let timestamps = moveTimestamps.get(runtime);
  if (!timestamps) {
    timestamps = new Map();
    moveTimestamps.set(runtime, timestamps);
  }
  const recent = (timestamps.get(sessionId) ?? []).filter((timestamp) => timestamp >= now - 1_000);
  if (recent.length >= MEMORY_PATH_SERVER_CONSTANTS.MOVE_MESSAGES_PER_SECOND) {
    timestamps.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  timestamps.set(sessionId, recent);
  return true;
}

/**
 * Authoritative Memory Path Colyseus room. The lobby hands the room a trusted
 * roster through memoryPathRoomOptionsSchema; each connected player arrives
 * with a server-issued seat reservation and is matched to the roster by
 * player id. The room owns timers, reconnection, phase transitions and the
 * synchronized projection; the engine owns the hidden rules.
 */
export class MemoryPathRoom extends Room<{ state: MemoryPathState }> {
  declare state: MemoryPathState;
  // Colyseus reserves a creator seat for the `matchMaker.create` call that
  // builds the room from the lobby. That reservation is never consumed by a
  // roster player, so the room needs one extra slot or an eight-player lobby
  // auto-locks before the last roster reservation is issued.
  override maxClients = MEMORY_PATH_SERVER_CONSTANTS.MAX_PLAYERS + 1;

  readonly #roomCreationToken: string;
  #engine!: MemoryPathRuntime;
  #roster: RosterPlayer[] = [];
  #transitionTimer: RoomTimer | null = null;
  #tickTimer: RoomTimer | null = null;

  constructor(roomCreationToken: string) {
    super();
    this.#roomCreationToken = roomCreationToken;
  }

  override onCreate(options: unknown): void {
    const parsed = memoryPathRoomOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    // Only the platform lobby can create a Memory Path room: the public
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

    this.state = new MemoryPathState();
    this.state.roomCode = parsed.data.roomCode;
    this.state.gameId = MEMORY_PATH_GAME_ID;
    const e2eMode = parsed.data.e2eMode ?? false;
    // Unconsumed transition reservations block disposal until they expire.
    // Keep the window short in test mode so aborted transitions clean up fast.
    this.seatReservationTimeout = e2eMode ? 2 : 15;
    this.#engine = createRuntime(createSettings(e2eMode));

    // The lobby disconnects itself shortly after issuing reservations. If any
    // roster player never arrives, this room cannot start and disposes itself
    // so the code mapping is released.
    this.#transitionTimer = this.clock.setTimeout(() => {
      if (this.#connectedRosterSize() < this.#roster.length) {
        void this.disconnect();
      }
    }, parsed.data.transitionTimeoutMs ?? MEMORY_PATH_SERVER_CONSTANTS.TRANSITION_TIMEOUT_MS);

    this.#tickTimer = this.clock.setInterval(
      () => this.#tick(),
      MEMORY_PATH_SERVER_CONSTANTS.SERVER_UPDATE_MS,
    );

    this.onMessage(MEMORY_PATH_MESSAGE_TYPES.move, (client, message: unknown) => {
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
    const rosterPlayer = this.#roster.find((p) => p.playerId === parsed.data.playerId);
    if (!rosterPlayer || rosterPlayer.connectedSessionId !== null) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Room not joinable");
    }
    if (this.#engine.phase !== "lobby") {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Room not joinable");
    }

    rosterPlayer.connectedSessionId = client.sessionId;
    this.#engine.players.set(
      client.sessionId,
      createRuntimePlayer(client.sessionId, rosterPlayer.playerName, rosterPlayer.joinedOrder, ""),
    );
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
    const player = this.#engine.players.get(client.sessionId);
    if (!player) {
      return;
    }
    player.connected = false;
    player.roundActive = false;
    player.inputX = 0;
    player.inputY = 0;
    evaluateNoEligible(this.#engine);
    this.#sync();
    void this.allowReconnection(
      client,
      MEMORY_PATH_SERVER_CONSTANTS.RECONNECT_GRACE_MS / 1000,
    ).catch(() => {
      // Grace expired or the room is closing; onLeave finalises the removal.
    });
  }

  override onReconnect(client: Client): void {
    const player = this.#engine.players.get(client.sessionId);
    if (!player) {
      return;
    }
    player.connected = true;
    player.inputX = 0;
    player.inputY = 0;
    if (this.#engine.suddenDeath && !player.participating) {
      const maxWins = Math.max(
        0,
        ...[...this.#engine.players.values()].map((candidate) => candidate.roundWins),
      );
      // A tied leader who dropped during the previous round may rejoin sudden
      // death within the reconnection grace window.
      if (player.roundWins === maxWins) {
        player.participating = true;
      }
    }
    if (
      (this.#engine.phase === "preparing" ||
        this.#engine.phase === "preview" ||
        this.#engine.phase === "racing") &&
      player.participating
    ) {
      player.roundActive = true;
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
    this.#engine.players.delete(client.sessionId);
    if (wasHost) {
      this.#transferHost();
    }
    evaluateNoEligible(this.#engine);
    this.#sync();
    this.#tryAutoStart();
  }

  override onDispose(): void {
    this.#clearTransitionTimer();
    this.#clearTickTimer();
  }

  private move(client: Client, message: unknown): void {
    const parsed = memoryPathCommandSchema.safeParse(message);
    if (!parsed.success) {
      sendError(client, "INVALID_GAME_COMMAND", "Malformed game command");
      return;
    }
    const player = this.#engine.players.get(client.sessionId);
    if (!player) {
      sendError(client, "PLAYER_NOT_IN_ROOM", "You are not in this room");
      return;
    }
    const now = Date.now();
    const { sequence, roundNumber, x, y } = parsed.data;
    if (this.#engine.phase !== "racing") {
      client.send(MEMORY_PATH_MESSAGE_TYPES.moveRejected, {
        sequence,
        roundNumber,
        reason: "not-moving",
      });
      return;
    }
    if (
      !player.connected ||
      !player.participating ||
      !player.roundActive ||
      player.finished ||
      player.falling
    ) {
      client.send(MEMORY_PATH_MESSAGE_TYPES.moveRejected, {
        sequence,
        roundNumber,
        reason: "not-active",
      });
      return;
    }
    if (roundNumber !== this.#engine.roundNumber) {
      client.send(MEMORY_PATH_MESSAGE_TYPES.moveRejected, {
        sequence,
        roundNumber,
        reason: "old-round",
      });
      return;
    }
    if (player.seenMoveSequences.has(sequence) || sequence < player.lastAcceptedSequence - 64) {
      client.send(MEMORY_PATH_MESSAGE_TYPES.moveRejected, {
        sequence,
        roundNumber,
        reason: "stale-sequence",
      });
      return;
    }
    if (!consumeMoveRateLimit(this.#engine, client.sessionId, now)) {
      client.send(MEMORY_PATH_MESSAGE_TYPES.moveRejected, {
        sequence,
        roundNumber,
        reason: "rate-limited",
      });
      return;
    }

    player.seenMoveSequences.add(sequence);
    player.lastAcceptedSequence = Math.max(player.lastAcceptedSequence, sequence);
    for (const stale of [...player.seenMoveSequences]) {
      if (stale < player.lastAcceptedSequence - 64) {
        player.seenMoveSequences.delete(stale);
      }
    }
    player.inputX = x;
    player.inputY = y;
  }

  private playAgain(client: Client): void {
    if (client.sessionId !== this.state.hostSessionId) {
      sendError(client, "NOT_HOST", "Only the host can play again");
      return;
    }
    if (this.#engine.phase !== "match-result") {
      sendError(client, "GAME_NOT_RUNNING", "Play again is only available after a match");
      return;
    }
    resetForNewMatch(this.#engine);
    this.#sync();
    this.#tryAutoStart();
  }

  #tick(): void {
    updateRuntime(this.#engine, Date.now());
    this.#sync();
  }

  /**
   * Start play automatically once every roster player is connected. This is
   * the single-start contract: the platform lobby's Start button transitions
   * everyone here, and round 1 begins when the last player arrives. It also
   * restarts immediately after Play again when the whole roster is present.
   */
  #tryAutoStart(): void {
    const runtime = this.#engine;
    if (runtime.phase !== "lobby") {
      return;
    }
    const connectedRosterSize = this.#connectedRosterSize();
    if (connectedRosterSize < MEMORY_PATH_SERVER_CONSTANTS.MIN_PLAYERS) {
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
    syncMemoryPathState(this.state, this.#engine);
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

  #clearTransitionTimer(): void {
    this.#transitionTimer?.clear();
    this.#transitionTimer = null;
  }

  #clearTickTimer(): void {
    this.#tickTimer?.clear();
    this.#tickTimer = null;
  }
}

export type { RuntimePlayer } from "./types.js";
