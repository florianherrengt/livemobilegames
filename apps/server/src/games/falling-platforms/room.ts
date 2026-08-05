import {
  FALLING_PLATFORMS_GAME_ID,
  FALLING_PLATFORMS_MESSAGE_TYPES,
  FallingPlatformsState,
  fallingPlatformsCommandSchema,
  ROOM_MESSAGE_TYPES,
  seatOptionsSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";
import { type Client, ErrorCode, Room, ServerError } from "colyseus";

import { FALLING_PLATFORMS_SERVER_CONSTANTS } from "./constants.js";
import {
  addPlayer,
  createRuntime,
  removePlayer,
  resetForNewMatch,
  startMatch,
  updateMatch,
} from "./engine.js";
import { startHop, validateHop } from "./hopping.js";
import { fallingPlatformsRoomOptionsSchema } from "./room-options.js";
import { buildSettings } from "./settings.js";
import { syncFallingPlatformsState } from "./sync.js";
import type { MatchRuntime } from "./types.js";

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

const hopTimestamps = new WeakMap<MatchRuntime, Map<string, number[]>>();

function consumeHopRateLimit(runtime: MatchRuntime, sessionId: string, now: number): boolean {
  let timestamps = hopTimestamps.get(runtime);
  if (!timestamps) {
    timestamps = new Map();
    hopTimestamps.set(runtime, timestamps);
  }
  const recent = (timestamps.get(sessionId) ?? []).filter((timestamp) => timestamp >= now - 1000);
  if (recent.length >= FALLING_PLATFORMS_SERVER_CONSTANTS.HOP_MESSAGES_PER_SECOND) {
    timestamps.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  timestamps.set(sessionId, recent);
  return true;
}

/**
 * Authoritative Falling Platforms Colyseus room. The lobby hands the room a
 * trusted roster through fallingPlatformsRoomOptionsSchema; each connected
 * player arrives with a server-issued seat reservation and is matched to the
 * roster by player id. The room owns timers, reconnection, phase transitions
 * and the synchronized projection; the engine owns the hidden rules.
 */
export class FallingPlatformsRoom extends Room<{ state: FallingPlatformsState }> {
  declare state: FallingPlatformsState;
  // Colyseus reserves a creator seat for the `matchMaker.create` call that
  // builds the room from the lobby. That reservation is never consumed by a
  // roster player, so the room needs one extra slot or an eight-player lobby
  // auto-locks before the last roster reservation is issued.
  override maxClients = FALLING_PLATFORMS_SERVER_CONSTANTS.MAX_PLAYERS + 1;

  readonly #roomCreationToken: string;
  #engine!: MatchRuntime;
  #roster: RosterPlayer[] = [];
  #transitionTimer: RoomTimer | null = null;
  #tickTimer: RoomTimer | null = null;

  constructor(roomCreationToken: string) {
    super();
    this.#roomCreationToken = roomCreationToken;
  }

  override onCreate(options: unknown): void {
    const parsed = fallingPlatformsRoomOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    // Only the platform lobby can create a Falling Platforms room: the public
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

    this.state = new FallingPlatformsState();
    this.state.roomCode = parsed.data.roomCode;
    this.state.gameId = FALLING_PLATFORMS_GAME_ID;
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
    }, parsed.data.transitionTimeoutMs ?? FALLING_PLATFORMS_SERVER_CONSTANTS.TRANSITION_TIMEOUT_MS);

    this.#tickTimer = this.clock.setInterval(
      () => this.#tick(),
      FALLING_PLATFORMS_SERVER_CONSTANTS.SERVER_UPDATE_MS,
    );

    this.onMessage(FALLING_PLATFORMS_MESSAGE_TYPES.hop, (client, message: unknown) => {
      this.hop(client, message);
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
    const player = this.state.players.get(client.sessionId);
    if (!runtimePlayer || !player) {
      return;
    }
    runtimePlayer.connected = false;
    player.connected = false;
    void this.allowReconnection(
      client,
      FALLING_PLATFORMS_SERVER_CONSTANTS.RECONNECT_GRACE_MS / 1000,
    ).catch(() => {
      // Grace expired or the room is closing; onLeave finalises the removal.
    });
  }

  override onReconnect(client: Client): void {
    const runtimePlayer = this.#engine.players.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtimePlayer || !player) {
      return;
    }
    runtimePlayer.connected = true;
    player.connected = true;
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
    removePlayer(this.#engine, client.sessionId, Date.now());
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

  private hop(client: Client, message: unknown): void {
    const parsed = fallingPlatformsCommandSchema.safeParse(message);
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
    if (!consumeHopRateLimit(this.#engine, client.sessionId, now)) {
      client.send(FALLING_PLATFORMS_MESSAGE_TYPES.hopRejected, {
        sequence: parsed.data.sequence,
        reason: "rate-limited",
      });
      return;
    }
    const reason = validateHop(
      this.#engine,
      player,
      parsed.data.targetPlatformId,
      parsed.data.sequence,
    );
    if (reason !== null) {
      client.send(FALLING_PLATFORMS_MESSAGE_TYPES.hopRejected, {
        sequence: parsed.data.sequence,
        reason,
      });
      return;
    }
    startHop(this.#engine, player, parsed.data.targetPlatformId, parsed.data.sequence, now);
    this.#sync();
  }

  private playAgain(client: Client): void {
    if (client.sessionId !== this.state.hostSessionId) {
      sendError(client, "NOT_HOST", "Only the host can play again");
      return;
    }
    if (this.#engine.phase !== "lobby") {
      sendError(client, "GAME_NOT_RUNNING", "Play again is only available from the lobby");
      return;
    }
    resetForNewMatch(this.#engine);
    this.#sync();
    this.#tryAutoStart();
  }

  #tick(): void {
    const now = Date.now();
    updateMatch(this.#engine, now);
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
    if (connectedRosterSize < FALLING_PLATFORMS_SERVER_CONSTANTS.MIN_PLAYERS) {
      return;
    }
    if (connectedRosterSize !== this.#roster.length) {
      return;
    }
    startMatch(this.#engine, Date.now());
    this.#sync();
  }

  #sync(): void {
    syncFallingPlatformsState(this.state, this.#engine);
  }

  #transferHost(): void {
    const remaining = this.#roster
      .filter((rosterPlayer) => rosterPlayer.connectedSessionId !== null)
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    const next = remaining[0];
    if (!next || next.connectedSessionId === null) {
      this.state.hostSessionId = "";
      return;
    }
    this.state.hostSessionId = next.connectedSessionId;
  }

  #connectedRosterSize(): number {
    return this.#roster.filter((player) => player.connectedSessionId !== null).length;
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
