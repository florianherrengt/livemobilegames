import {
  KART_RACING_GAME_ID,
  KART_RACING_MESSAGE_TYPES,
  KartRacingState,
  kartShootCommandSchema,
  kartSteerCommandSchema,
  ROOM_MESSAGE_TYPES,
  seatOptionsSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";
import { type Client, ErrorCode, Room, ServerError } from "colyseus";

import { KART_RACING_SERVER_CONSTANTS } from "./constants.js";
import { endRaceIfAllDisconnected, fireProjectile, updateRuntime } from "./engine.js";
import { kartRacingRoomOptionsSchema } from "./room-options.js";
import {
  createRuntime,
  createRuntimePlayer,
  createSettings,
  resetForNewMatch,
  startMatch,
} from "./runtime.js";
import { syncKartRacingState } from "./sync.js";
import { lastGateIndexForPlayer, safeRespawnPoint } from "./track.js";
import type { KartRacingRuntime, RuntimePlayer } from "./types.js";

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

function rejectCommand(
  client: Client,
  commandType: "steer" | "shoot",
  sequence: number,
  raceNumber: number,
  reason:
    | "not-racing"
    | "not-active"
    | "old-race"
    | "stale-sequence"
    | "rate-limited"
    | "no-ammo"
    | "disabled",
): void {
  client.send(KART_RACING_MESSAGE_TYPES.commandRejected, {
    commandType,
    sequence,
    raceNumber,
    reason,
  });
}

function consumeRateLimit(
  timestamps: Map<string, number[]>,
  sessionId: string,
  now: number,
  maxPerSecond: number,
): boolean {
  const recent = (timestamps.get(sessionId) ?? []).filter((timestamp) => timestamp >= now - 1_000);
  if (recent.length >= maxPerSecond) {
    timestamps.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  timestamps.set(sessionId, recent);
  return true;
}

const steerTimestamps = new WeakMap<KartRacingRuntime, Map<string, number[]>>();
const shootTimestamps = new WeakMap<KartRacingRuntime, Map<string, number[]>>();

/**
 * Authoritative Kart Racing Colyseus room. The lobby hands the room a trusted
 * roster through kartRacingRoomOptionsSchema; each connected player arrives
 * with a server-issued seat reservation and is matched to the roster by player
 * id. The room owns timers, reconnection, phase transitions and the
 * synchronized projection; the feature modules own the hidden rules.
 */
export class KartRacingRoom extends Room<{ state: KartRacingState }> {
  declare state: KartRacingState;
  // Colyseus reserves a creator seat for the `matchMaker.create` call that
  // builds the room from the lobby. That reservation is never consumed by a
  // roster player, so the room needs one extra slot or an eight-player lobby
  // auto-locks before the last roster reservation is issued.
  override maxClients = KART_RACING_SERVER_CONSTANTS.MAX_PLAYERS + 1;

  readonly #roomCreationToken: string;
  #engine!: KartRacingRuntime;
  #roster: RosterPlayer[] = [];
  #transitionTimer: RoomTimer | null = null;
  #tickTimer: RoomTimer | null = null;

  constructor(roomCreationToken: string) {
    super();
    this.#roomCreationToken = roomCreationToken;
  }

  override onCreate(options: unknown): void {
    const parsed = kartRacingRoomOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    if (parsed.data.roomCreationToken !== this.#roomCreationToken) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    this.#roster = [...parsed.data.players]
      .sort((a, b) => a.joinedOrder - b.joinedOrder)
      .map((player) => ({
        ...player,
        connectedSessionId: null,
      }));

    this.state = new KartRacingState();
    this.state.roomCode = parsed.data.roomCode;
    this.state.gameId = KART_RACING_GAME_ID;
    const e2eMode = parsed.data.e2eMode ?? false;
    this.seatReservationTimeout = e2eMode ? 2 : 15;
    this.#engine = createRuntime(createSettings(e2eMode));

    this.#transitionTimer = this.clock.setTimeout(() => {
      if (this.#connectedRosterSize() < this.#roster.length) {
        void this.disconnect();
      }
    }, parsed.data.transitionTimeoutMs ?? KART_RACING_SERVER_CONSTANTS.TRANSITION_TIMEOUT_MS);

    this.#tickTimer = this.clock.setInterval(
      () => this.#tick(),
      KART_RACING_SERVER_CONSTANTS.SERVER_UPDATE_MS,
    );

    this.onMessage(KART_RACING_MESSAGE_TYPES.steer, (client, message: unknown) => {
      this.steer(client, message);
    });
    this.onMessage(KART_RACING_MESSAGE_TYPES.shoot, (client, message: unknown) => {
      this.shoot(client, message);
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
      createRuntimePlayer(
        client.sessionId,
        rosterPlayer.playerId,
        rosterPlayer.playerName,
        rosterPlayer.joinedOrder,
        "",
      ),
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
    player.active = false;
    player.steering = 0;
    player.targetSteering = 0;
    if (this.#engine.phase === "racing") {
      endRaceIfAllDisconnected(this.#engine, Date.now());
    }
    this.#sync();
    void this.allowReconnection(
      client,
      KART_RACING_SERVER_CONSTANTS.RECONNECT_GRACE_MS / 1_000,
    ).catch(() => {
      // Grace expired or the room is closing; onLeave finalises the removal.
    });
  }

  override onReconnect(client: Client): void {
    const player = this.#engine.players.get(client.sessionId);
    if (!player) {
      return;
    }
    const now = Date.now();
    player.connected = true;
    // A reconnecting player does not keep an in-flight projectile.
    this.#engine.projectiles = this.#engine.projectiles.filter(
      (projectile) => projectile.ownerSessionId !== player.sessionId,
    );
    if (this.#engine.phase === "countdown" && !player.removed && !player.finished) {
      const gridIndex = this.#engine.startingGrid.indexOf(player.sessionId);
      const gridPosition = this.#engine.track.gridPositions[gridIndex];
      if (gridPosition !== undefined) {
        player.x = gridPosition.x;
        player.y = gridPosition.y;
        player.prevX = gridPosition.x;
        player.prevY = gridPosition.y;
        player.heading = this.#engine.track.startingHeading;
        player.speed = 0;
        player.active = true;
      }
    } else if (this.#engine.phase === "racing" && !player.removed && !player.finished) {
      this.#beginReconnectRespawn(player, now);
    }
    this.#sync(now);
    this.#tryAutoStart();
  }

  override onLeave(client: Client): void {
    const player = this.#engine.players.get(client.sessionId);
    if (!player) {
      return;
    }
    const wasHost = client.sessionId === this.state.hostSessionId;
    if (this.#engine.totalRaces === 0) {
      this.state.players.delete(client.sessionId);
      this.#roster = this.#roster.filter(
        (rosterPlayer) => rosterPlayer.connectedSessionId !== client.sessionId,
      );
      this.#engine.players.delete(client.sessionId);
    } else {
      player.removed = true;
      player.connected = false;
      player.active = false;
      player.steering = 0;
      player.targetSteering = 0;
    }
    if (wasHost) {
      this.#transferHost();
    }
    if (this.#engine.phase === "racing") {
      endRaceIfAllDisconnected(this.#engine, Date.now());
    }
    this.#sync();
    this.#tryAutoStart();
  }

  override onDispose(): void {
    this.#clearTransitionTimer();
    this.#clearTickTimer();
  }

  private steer(client: Client, message: unknown): void {
    const parsed = kartSteerCommandSchema.safeParse(message);
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
    if (runtime.phase !== "countdown" && runtime.phase !== "racing") {
      rejectCommand(client, "steer", parsed.data.sequence, parsed.data.raceNumber, "not-racing");
      return;
    }
    if (!player.raceActive || player.removed) {
      rejectCommand(client, "steer", parsed.data.sequence, parsed.data.raceNumber, "not-active");
      return;
    }
    if (parsed.data.raceNumber !== runtime.raceNumber) {
      rejectCommand(client, "steer", parsed.data.sequence, parsed.data.raceNumber, "old-race");
      return;
    }
    if (!this.#acceptSequence(player, parsed.data.sequence, "steer")) {
      rejectCommand(
        client,
        "steer",
        parsed.data.sequence,
        parsed.data.raceNumber,
        "stale-sequence",
      );
      return;
    }
    if (
      !consumeRateLimit(
        this.#timestamps(steerTimestamps),
        client.sessionId,
        Date.now(),
        KART_RACING_SERVER_CONSTANTS.STEERING_MESSAGES_PER_SECOND,
      )
    ) {
      rejectCommand(client, "steer", parsed.data.sequence, parsed.data.raceNumber, "rate-limited");
      return;
    }
    player.targetSteering = Math.max(-1, Math.min(1, parsed.data.steering));
  }

  private shoot(client: Client, message: unknown): void {
    const parsed = kartShootCommandSchema.safeParse(message);
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
    const now = Date.now();
    if (runtime.phase !== "racing") {
      rejectCommand(client, "shoot", parsed.data.sequence, parsed.data.raceNumber, "not-racing");
      return;
    }
    if (
      !player.raceActive ||
      player.removed ||
      !player.active ||
      !player.connected ||
      player.finished
    ) {
      rejectCommand(client, "shoot", parsed.data.sequence, parsed.data.raceNumber, "not-active");
      return;
    }
    if (parsed.data.raceNumber !== runtime.raceNumber) {
      rejectCommand(client, "shoot", parsed.data.sequence, parsed.data.raceNumber, "old-race");
      return;
    }
    if (!this.#acceptSequence(player, parsed.data.sequence, "shoot")) {
      rejectCommand(
        client,
        "shoot",
        parsed.data.sequence,
        parsed.data.raceNumber,
        "stale-sequence",
      );
      return;
    }
    if (
      !consumeRateLimit(
        this.#timestamps(shootTimestamps),
        client.sessionId,
        now,
        KART_RACING_SERVER_CONSTANTS.SHOOT_MESSAGES_PER_SECOND,
      )
    ) {
      rejectCommand(client, "shoot", parsed.data.sequence, parsed.data.raceNumber, "rate-limited");
      return;
    }
    if (!player.ammoLoaded) {
      rejectCommand(client, "shoot", parsed.data.sequence, parsed.data.raceNumber, "no-ammo");
      return;
    }
    if (player.hitStopUntil > now || player.respawnUntil > now) {
      rejectCommand(client, "shoot", parsed.data.sequence, parsed.data.raceNumber, "disabled");
      return;
    }
    fireProjectile(runtime, player);
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
    // resetForNewMatch drops permanently-removed players from the runtime;
    // prune the roster so the remaining connected players can auto-start.
    this.#roster = this.#roster.filter(
      (rosterPlayer) =>
        rosterPlayer.connectedSessionId !== null &&
        this.#engine.players.has(rosterPlayer.connectedSessionId),
    );
    this.#sync();
    this.#tryAutoStart();
  }

  #tick(): void {
    const now = Date.now();
    updateRuntime(this.#engine, now);
    this.#sync(now);
  }

  #beginReconnectRespawn(player: RuntimePlayer, now: number): void {
    const runtime = this.#engine;
    const lastGateIndex = lastGateIndexForPlayer(runtime.track, player);
    const occupied = (x: number, y: number): boolean =>
      [...runtime.players.values()].some(
        (other) =>
          other.sessionId !== player.sessionId &&
          other.active &&
          Math.hypot(other.x - x, other.y - y) < runtime.settings.config.KART_RADIUS * 2,
      );
    const respawn = safeRespawnPoint(runtime.track, lastGateIndex, occupied);
    player.respawnPoint = respawn;
    player.respawnHeading = respawn.heading;
    player.respawnUntil = now + runtime.settings.config.RESPAWN_DELAY_MS;
    player.active = false;
    player.speed = 0;
    player.steering = 0;
    player.targetSteering = 0;
    player.hitStopUntil = 0;
    player.immunityUntil = 0;
    player.respawnImmunityUntil = 0;
  }

  /**
   * Start play automatically once every roster player is connected. This is
   * the single-start contract: the platform lobby's Start button transitions
   * everyone here, and race 1 begins when the last player arrives. It also
   * restarts immediately after Play again when the whole roster is present.
   */
  #tryAutoStart(): void {
    const runtime = this.#engine;
    if (runtime.phase !== "lobby") {
      return;
    }
    const connectedRosterSize = this.#connectedRosterSize();
    if (connectedRosterSize < KART_RACING_SERVER_CONSTANTS.MIN_PLAYERS) {
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

  #acceptSequence(
    player: RuntimePlayer,
    sequence: number,
    commandType: "steer" | "shoot",
  ): boolean {
    const lastKey = commandType === "steer" ? "lastSteerSequence" : "lastShootSequence";
    const seenKey = commandType === "steer" ? "seenSteerSequences" : "seenShootSequences";
    const seen = player[seenKey];
    if (seen.has(sequence) || sequence < player[lastKey] - 64) {
      return false;
    }
    seen.add(sequence);
    player[lastKey] = Math.max(player[lastKey], sequence);
    for (const old of [...seen]) {
      if (old < player[lastKey] - 64) {
        seen.delete(old);
      }
    }
    return true;
  }

  #timestamps(map: WeakMap<KartRacingRuntime, Map<string, number[]>>): Map<string, number[]> {
    let timestamps = map.get(this.#engine);
    if (!timestamps) {
      timestamps = new Map();
      map.set(this.#engine, timestamps);
    }
    return timestamps;
  }

  #sync(now = Date.now()): void {
    syncKartRacingState(this.state, this.#engine, now);
  }

  #transferHost(): void {
    const remaining = this.#roster
      .filter((rosterPlayer) => rosterPlayer.connectedSessionId !== null)
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    const next = remaining.find(
      (rosterPlayer) => this.#engine.players.get(rosterPlayer.connectedSessionId ?? "")?.connected,
    );
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
