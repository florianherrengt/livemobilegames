import { type Client, ErrorCode, Room, ServerError } from "@colyseus/core";
import {
  FLAPPY_RACE_GAME_ID,
  FLAPPY_RACE_MESSAGE_TYPES,
  FlappyRaceState,
  flappyRaceCommandSchema,
  ROOM_MESSAGE_TYPES,
  seatOptionsSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";

import { FLAPPY_RACE_SERVER_CONSTANTS } from "./constants.js";
import {
  consumeFlapRateLimit,
  createFlapTimestampMap,
  type FlapTimestampMap,
} from "./rate-limit.js";
import { flappyRaceRoomOptionsSchema } from "./room-options.js";
import {
  createRuntime,
  createRuntimePlayer,
  createSettings,
  resetForNewMatch,
  startMatch,
} from "./runtime.js";
import { evaluateRoundEnd, updateRuntime } from "./simulation.js";
import { syncFlappyRaceState } from "./sync.js";
import type { FlappyRaceRuntime } from "./types.js";

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

const flapTimestamps = new WeakMap<FlappyRaceRuntime, FlapTimestampMap>();

/**
 * Authoritative Flappy Race Colyseus room. The lobby hands the room a trusted
 * roster through flappyRaceRoomOptionsSchema; each connected player arrives
 * with a server-issued seat reservation and is matched to the roster by player
 * id. The room owns timers, reconnection, phase transitions and the
 * synchronized projection; the feature modules own the hidden rules.
 */
export class FlappyRaceRoom extends Room<{ state: FlappyRaceState }> {
  declare state: FlappyRaceState;
  // Colyseus reserves a creator seat for the `matchMaker.create` call that
  // builds the room from the lobby. That reservation is never consumed by a
  // roster player, so the room needs one extra slot or an eight-player lobby
  // auto-locks before the last roster reservation is issued.
  override maxClients = FLAPPY_RACE_SERVER_CONSTANTS.MAX_PLAYERS + 1;

  readonly #roomCreationToken: string;
  #engine!: FlappyRaceRuntime;
  #roster: RosterPlayer[] = [];
  #transitionTimer: RoomTimer | null = null;
  #tickTimer: RoomTimer | null = null;

  constructor(roomCreationToken: string) {
    super();
    this.#roomCreationToken = roomCreationToken;
  }

  override onCreate(options: unknown): void {
    const parsed = flappyRaceRoomOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    // Only the platform lobby can create a Flappy Race room: the public
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

    this.state = new FlappyRaceState();
    this.state.roomCode = parsed.data.roomCode;
    this.state.gameId = FLAPPY_RACE_GAME_ID;
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
    }, parsed.data.transitionTimeoutMs ?? FLAPPY_RACE_SERVER_CONSTANTS.TRANSITION_TIMEOUT_MS);

    this.#tickTimer = this.clock.setInterval(
      () => this.#tick(),
      FLAPPY_RACE_SERVER_CONSTANTS.SERVER_UPDATE_MS,
    );

    this.onMessage(FLAPPY_RACE_MESSAGE_TYPES.flap, (client, message: unknown) => {
      this.flap(client, message);
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
    const runtimePlayer = this.#engine.players.get(client.sessionId);
    if (!runtimePlayer) {
      return;
    }
    runtimePlayer.connected = false;
    runtimePlayer.eligible = false;
    runtimePlayer.roundActive = false;
    runtimePlayer.eliminated = true;
    runtimePlayer.flapQueued = false;
    evaluateRoundEnd(this.#engine, Date.now());
    this.#sync();
    void this.allowReconnection(
      client,
      FLAPPY_RACE_SERVER_CONSTANTS.RECONNECT_GRACE_MS / 1000,
    ).catch(() => {
      // Grace expired or the room is closing; onLeave finalises the removal.
    });
  }

  override onReconnect(client: Client): void {
    const runtimePlayer = this.#engine.players.get(client.sessionId);
    if (!runtimePlayer) {
      return;
    }
    runtimePlayer.connected = true;
    if (this.#engine.phase === "lobby") {
      // A reconnect before the match starts stays eligible; a reconnect
      // mid-match spectates the rest of the match.
      runtimePlayer.eligible = true;
      runtimePlayer.roundActive = false;
      runtimePlayer.eliminated = false;
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
    evaluateRoundEnd(this.#engine, Date.now());
    this.#sync();
    this.#tryAutoStart();
  }

  override onDispose(): void {
    this.#clearTransitionTimer();
    this.#clearTickTimer();
  }

  private flap(client: Client, message: unknown): void {
    const parsed = flappyRaceCommandSchema.safeParse(message);
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
      this.#rejectFlap(client, parsed.data.sequence, parsed.data.roundNumber, "not-running");
      return;
    }
    if (!player.eligible || !player.roundActive || !player.connected) {
      this.#rejectFlap(client, parsed.data.sequence, parsed.data.roundNumber, "not-active");
      return;
    }
    if (parsed.data.roundNumber !== runtime.roundNumber) {
      this.#rejectFlap(client, parsed.data.sequence, parsed.data.roundNumber, "old-round");
      return;
    }
    if (
      player.seenFlapSequences.has(parsed.data.sequence) ||
      parsed.data.sequence < player.lastFlapSequence - 64
    ) {
      this.#rejectFlap(client, parsed.data.sequence, parsed.data.roundNumber, "stale-sequence");
      return;
    }
    if (
      !consumeFlapRateLimit(
        FLAPPY_RACE_SERVER_CONSTANTS,
        this.#timestamps(),
        client.sessionId,
        Date.now(),
      )
    ) {
      this.#rejectFlap(client, parsed.data.sequence, parsed.data.roundNumber, "rate-limited");
      return;
    }

    player.seenFlapSequences.add(parsed.data.sequence);
    player.lastFlapSequence = Math.max(player.lastFlapSequence, parsed.data.sequence);
    for (const sequence of [...player.seenFlapSequences]) {
      if (sequence < player.lastFlapSequence - 64) {
        player.seenFlapSequences.delete(sequence);
      }
    }
    player.flapQueued = true;
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
    if (connectedRosterSize < FLAPPY_RACE_SERVER_CONSTANTS.MIN_PLAYERS) {
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
    syncFlappyRaceState(this.state, this.#engine);
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

  #timestamps(): FlapTimestampMap {
    let timestamps = flapTimestamps.get(this.#engine);
    if (!timestamps) {
      timestamps = createFlapTimestampMap();
      flapTimestamps.set(this.#engine, timestamps);
    }
    return timestamps;
  }

  #rejectFlap(
    client: Client,
    sequence: number,
    roundNumber: number,
    reason: "not-running" | "not-active" | "old-round" | "stale-sequence" | "rate-limited",
  ): void {
    client.send(FLAPPY_RACE_MESSAGE_TYPES.flapRejected, {
      sequence,
      roundNumber,
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

export type { RuntimePlayer } from "./types.js";
