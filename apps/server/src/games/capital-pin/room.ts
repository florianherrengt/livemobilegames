import { randomBytes } from "node:crypto";
import { type Client, ErrorCode, Room, ServerError } from "@colyseus/core";
import {
  CAPITAL_PIN_GAME_ID,
  CapitalPinPlayerState,
  CapitalPinState,
  capitalPinCommandSchema,
  GAME_MESSAGE_TYPES,
  ROOM_MESSAGE_TYPES,
  seatOptionsSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";
import { CAPITALS } from "./capitals.js";
import { CAPITAL_PIN_CONSTANTS } from "./constants.js";
import { CapitalPinEngine } from "./engine.js";
import { capitalPinRoomOptionsSchema } from "./room-options.js";
import { clearCapitalPinProjection, syncCapitalPinState } from "./sync.js";
import { validateCapitalDataset } from "./validation.js";

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

/**
 * Authoritative Capital Pin Colyseus room. The lobby hands the room a trusted
 * roster through capitalPinRoomOptionsSchema; each connected player arrives
 * with a server-issued seat reservation and is matched to the roster by player
 * id. The room owns timers, reconnection, phase transitions and the
 * synchronized projection; the engine owns the hidden rules.
 */
export class CapitalPinRoom extends Room<{ state: CapitalPinState }> {
  declare state: CapitalPinState;
  // Colyseus reserves a creator seat for the `matchMaker.create` call that
  // builds the room from the lobby. That reservation is never consumed by a
  // roster player, so the room needs one extra slot or an eight-player lobby
  // auto-locks before the last roster reservation is issued.
  override maxClients = CAPITAL_PIN_CONSTANTS.MAX_PLAYERS + 1;

  readonly #roomCreationToken: string;
  #engine!: CapitalPinEngine;
  #roster: RosterPlayer[] = [];
  #transitionTimer: RoomTimer | null = null;
  #roundEndTimer: RoomTimer | null = null;
  #advanceTimer: RoomTimer | null = null;

  constructor(roomCreationToken: string) {
    super();
    this.#roomCreationToken = roomCreationToken;
  }

  override onCreate(options: unknown): void {
    const parsed = capitalPinRoomOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    // Only the platform lobby can create a Capital Pin room: the public
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

    this.state = new CapitalPinState();
    this.state.roomCode = parsed.data.roomCode;
    this.state.gameId = CAPITAL_PIN_GAME_ID;
    const e2eMode = parsed.data.e2eMode ?? false;
    // Unconsumed transition reservations block disposal until they expire.
    // Keep the window short in test mode so aborted transitions clean up fast.
    this.seatReservationTimeout = e2eMode ? 2 : 15;
    this.#engine = new CapitalPinEngine(() => Date.now(), {
      totalRounds: CAPITAL_PIN_CONSTANTS.TOTAL_ROUNDS,
      roundDurationMs: e2eMode
        ? CAPITAL_PIN_CONSTANTS.E2E_ROUND_DURATION_MS
        : CAPITAL_PIN_CONSTANTS.ROUND_DURATION_MS,
      resultsDurationMs: e2eMode
        ? CAPITAL_PIN_CONSTANTS.E2E_RESULTS_DURATION_MS
        : CAPITAL_PIN_CONSTANTS.RESULTS_DURATION_MS,
      capitals: CAPITALS,
      // Authoritative game randomness uses the same crypto RNG as codes and
      // tokens; Math.random is not acceptable for a server-side seed.
      random: () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48,
    });
    validateCapitalDataset(CAPITALS);

    // The lobby disconnects itself shortly after issuing reservations. If any
    // roster player never arrives, this room cannot start and disposes itself
    // so the code mapping is released.
    this.#transitionTimer = this.clock.setTimeout(() => {
      if (this.#connectedRosterSize() < this.#roster.length) {
        void this.disconnect();
      }
    }, parsed.data.transitionTimeoutMs ?? CAPITAL_PIN_CONSTANTS.TRANSITION_TIMEOUT_MS);

    this.onMessage(GAME_MESSAGE_TYPES.submit, (client, message: unknown) => {
      this.submitGuess(client, message);
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
    const player = new CapitalPinPlayerState();
    player.playerId = rosterPlayer.playerId;
    player.name = rosterPlayer.playerName;
    player.isHost = rosterPlayer.isHost;
    player.connectionStatus = "connected";
    this.state.players.set(client.sessionId, player);
    if (rosterPlayer.isHost) {
      this.state.hostSessionId = client.sessionId;
    }

    if (this.#connectedRosterSize() === this.#roster.length) {
      this.#clearTransitionTimer();
      this.#tryAutoStart();
    }
  }

  override onDrop(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    player.connectionStatus = "reconnecting";
    void this.allowReconnection(client, CAPITAL_PIN_CONSTANTS.RECONNECT_GRACE_MS / 1000).catch(
      () => {
        // Grace expired or the room is closing; onLeave finalises the removal.
      },
    );
  }

  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    player.connectionStatus = "connected";
    this.#tryAutoStart();
    if (
      this.#engine.phase === "round" &&
      this.#engine.allConnectedParticipantsSubmitted(this.#connectedSessionIds())
    ) {
      this.#endRound();
    }
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    const wasHost = player.isHost;
    this.state.players.delete(client.sessionId);
    this.#roster = this.#roster.filter(
      (rosterPlayer) => rosterPlayer.connectedSessionId !== client.sessionId,
    );
    this.#engine.onPlayerRemoved(client.sessionId);
    if (wasHost) {
      this.#transferHost();
    }
    // In the pre-game lobby the engine has no participants yet, so a full
    // sync would prune the player map; membership is managed directly there.
    if (this.#engine.phase !== "lobby") {
      this.#sync();
    }
    this.#tryAutoStart();

    if (
      this.#engine.phase === "round" &&
      this.#engine.allConnectedParticipantsSubmitted(this.#connectedSessionIds())
    ) {
      this.#endRound();
    }
  }

  override onDispose(): void {
    this.#clearTransitionTimer();
    this.#clearRoundEndTimer();
    this.#clearAdvanceTimer();
  }

  private submitGuess(client: Client, message: unknown): void {
    const parsed = capitalPinCommandSchema.safeParse(message);
    if (!parsed.success) {
      sendError(client, "INVALID_GAME_COMMAND", "Malformed game command");
      return;
    }
    const error = this.#engine.submit(
      client.sessionId,
      parsed.data.roundNumber,
      parsed.data.latitude,
      parsed.data.longitude,
    );
    if (error !== null) {
      sendError(client, error, this.#messageFor(error));
      return;
    }
    this.#sync();
    if (
      this.#engine.phase === "round" &&
      this.#engine.allConnectedParticipantsSubmitted(this.#connectedSessionIds())
    ) {
      this.#endRound();
    }
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
    this.#clearRoundEndTimer();
    this.#clearAdvanceTimer();
    this.#engine.reset();
    // Reset the projection directly: a full sync would prune the player map,
    // because the engine no longer has participants until the next start.
    clearCapitalPinProjection(this.state);
    this.#tryAutoStart();
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
    if (connectedRosterSize < CAPITAL_PIN_CONSTANTS.MIN_PLAYERS) {
      return;
    }
    if (connectedRosterSize !== this.#roster.length) {
      return;
    }
    this.#engine.start([...this.state.players.keys()], (sessionId) => {
      return this.state.players.get(sessionId)?.name ?? "Unknown";
    });
    this.#sync();
    this.#scheduleRoundEnd();
  }

  #endRound(): void {
    this.#engine.endRound();
    this.#clearRoundEndTimer();
    this.#sync();
    this.#clearAdvanceTimer();
    this.#advanceTimer = this.clock.setTimeout(
      () => {
        this.#advanceFromResults();
      },
      Math.max(0, this.#engine.resultsEndsAt - Date.now()),
    );
  }

  #advanceFromResults(): void {
    const phase = this.#engine.phase;
    if (phase !== "round-results") {
      return;
    }
    this.#engine.advanceFromResults();
    this.#sync();
    if (this.#engine.phase === "round") {
      this.#scheduleRoundEnd();
    }
  }

  #scheduleRoundEnd(): void {
    this.#clearRoundEndTimer();
    this.#roundEndTimer = this.clock.setTimeout(
      () => {
        if (this.#engine.phase === "round") {
          this.#endRound();
        }
      },
      Math.max(0, this.#engine.roundEndsAt - Date.now()),
    );
  }

  #sync(): void {
    syncCapitalPinState(this.state, this.#engine);
  }

  #transferHost(): void {
    const remaining = this.#roster
      .filter((rosterPlayer) => rosterPlayer.connectedSessionId !== null)
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    for (const player of this.state.players.values()) {
      player.isHost = false;
    }
    const next = remaining[0];
    if (!next || next.connectedSessionId === null) {
      this.state.hostSessionId = "";
      return;
    }
    const player = this.state.players.get(next.connectedSessionId);
    if (player) {
      player.isHost = true;
      this.state.hostSessionId = next.connectedSessionId;
    }
  }

  #connectedSessionIds(): Set<string> {
    return new Set(
      [...this.state.players.entries()]
        .filter(([, player]) => player.connectionStatus === "connected")
        .map(([sessionId]) => sessionId),
    );
  }

  #connectedRosterSize(): number {
    return this.#roster.filter((player) => {
      if (player.connectedSessionId === null) {
        return false;
      }
      return this.state.players.get(player.connectedSessionId)?.connectionStatus === "connected";
    }).length;
  }

  #messageFor(error: RoomErrorCode): string {
    switch (error) {
      case "GAME_NOT_RUNNING":
        return "There is no active round for this guess";
      case "PLAYER_NOT_IN_ROOM":
        return "You are not a participant in this game";
      case "INVALID_GAME_COMMAND":
        return "You have already locked your answer";
      default:
        return "The game rejected the command";
    }
  }

  #clearTransitionTimer(): void {
    this.#transitionTimer?.clear();
    this.#transitionTimer = null;
  }

  #clearRoundEndTimer(): void {
    this.#roundEndTimer?.clear();
    this.#roundEndTimer = null;
  }

  #clearAdvanceTimer(): void {
    this.#advanceTimer?.clear();
    this.#advanceTimer = null;
  }
}
