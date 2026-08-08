import { type Client, ErrorCode, Room, ServerError } from "@colyseus/core";
import {
  LIVE_DRAWING_GUESSING_GAME_ID,
  LIVE_DRAWING_GUESSING_MESSAGE_TYPES,
  LiveDrawingGuessingState,
  LiveDrawingStrokeState,
  liveDrawingDrawerRequestSchema,
  liveDrawingGuessSchema,
  liveDrawingStrokeSchema,
  liveDrawingUndoSchema,
  ROOM_MESSAGE_TYPES,
  seatOptionsSchema,
  startGameRequestSchema,
} from "@phone-party/protocol";

import { LIVE_DRAWING_GUESSING_SERVER_CONSTANTS } from "./constants.js";
import {
  advanceAfterResult,
  advanceReveals,
  beginDrawing,
  beginTurn,
  connectedGuesserCount,
  createRuntime,
  createRuntimePlayer,
  createSettings,
  expireDrawerHold,
  type LiveDrawingRuntime,
  matchesAnswer,
  type RuntimePlayer,
  resolveTurn,
  resumeDrawerHold,
  startDrawerHold,
  startMatch,
} from "./engine.js";
import { liveDrawingGuessingRoomOptionsSchema } from "./room-options.js";
import { syncLiveDrawingGuessingState } from "./sync.js";

type RoomTimer = ReturnType<Room["clock"]["setTimeout"]>;

type RoomErrorCode =
  | "INVALID_REQUEST"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "ROOM_FULL"
  | "GAME_NOT_RUNNING"
  | "PLAYER_NOT_IN_ROOM"
  | "INVALID_GAME_COMMAND"
  | "INTERNAL_ERROR";

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
 * Authoritative Live Drawing and Guessing Colyseus room.
 *
 * The lobby hands the room a trusted roster through the room options; each
 * roster player arrives with a server-issued seat reservation and is matched
 * by player id. The room owns timers, reconnection, holds, phase transitions,
 * stroke synchronization, and private guess feedback; engine.ts owns the
 * hidden rules.
 *
 * Unlike the platform's other game rooms, this room unlocks while a match is
 * running so players who join by code after the game started can spectate and
 * participate when the host starts the next game. Seat reservations still
 * require the process-local token through onAuth, so spectators are always
 * server-issued and can never forge a participant identity.
 */
export class LiveDrawingGuessingRoom extends Room<{ state: LiveDrawingGuessingState }> {
  declare state: LiveDrawingGuessingState;
  // Colyseus reserves a creator seat for the matchMaker.create call that
  // builds the room from the lobby. The room also hosts up to MAX_PLAYERS
  // participants plus MAX_SPECTATORS mid-game spectators.
  override maxClients =
    LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_PLAYERS +
    LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_SPECTATORS +
    1;

  readonly #roomCreationToken: string;
  #engine!: LiveDrawingRuntime;
  #roster: RosterPlayer[] = [];
  #transitionTimer: RoomTimer | null = null;
  #tickTimer: RoomTimer | null = null;
  #strokeTimestamps = new Map<string, number[]>();
  #guessTimestamps = new Map<string, number[]>();
  #strokePointCount = 0;
  #lastBriefedTurn = 0;

  constructor(roomCreationToken: string) {
    super();
    this.#roomCreationToken = roomCreationToken;
  }

  override onCreate(options: unknown): void {
    const parsed = liveDrawingGuessingRoomOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid room options");
    }
    // Only the platform lobby can create this room: the public Colyseus
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

    this.state = new LiveDrawingGuessingState();
    this.state.roomCode = parsed.data.roomCode;
    this.state.gameId = LIVE_DRAWING_GUESSING_GAME_ID;
    const e2eMode = parsed.data.e2eMode ?? false;
    // Unconsumed transition reservations block disposal until they expire.
    // Keep the window short in test mode so aborted transitions clean up fast.
    this.seatReservationTimeout = e2eMode ? 2 : 15;
    this.#engine = createRuntime(createSettings(e2eMode, parsed.data.e2eTurnDurationMs));

    // The lobby disconnects itself shortly after issuing reservations. If any
    // roster player never arrives, this room cannot start and disposes itself
    // so the code mapping is released.
    this.#transitionTimer = this.clock.setTimeout(() => {
      if (this.#connectedRosterSize() < this.#roster.length) {
        void this.disconnect();
      }
    }, parsed.data.transitionTimeoutMs ??
      LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.TRANSITION_TIMEOUT_MS);

    this.#tickTimer = this.clock.setInterval(
      () => this.#tick(),
      LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.TICK_MS,
    );

    this.onMessage(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.stroke, (client, message: unknown) => {
      this.#handleStroke(client, message);
    });
    this.onMessage(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.undo, (client, message: unknown) => {
      this.#handleUndo(client, message);
    });
    this.onMessage(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guess, (client, message: unknown) => {
      this.#handleGuess(client, message);
    });
    this.onMessage(
      LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerRequest,
      (client, message: unknown) => {
        if (!liveDrawingDrawerRequestSchema.safeParse(message).success) {
          sendError(client, "INVALID_REQUEST", "Malformed drawer request");
          return;
        }
        const player = this.#playerBySession(client.sessionId);
        if (
          player !== undefined &&
          player.playerId === this.#engine.drawerPlayerId &&
          (this.#engine.phase === "preparing" || this.#engine.phase === "drawing") &&
          player.connected
        ) {
          this.#sendDrawerBriefing(player);
        }
      },
    );
    this.onMessage(ROOM_MESSAGE_TYPES.playAgain, (client, message: unknown) => {
      if (!startGameRequestSchema.safeParse(message).success) {
        sendError(client, "INVALID_REQUEST", "Malformed play-again request");
        return;
      }
      this.#playAgain(client);
    });
  }

  override onJoin(client: Client, options: unknown): void {
    const parsed = seatOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid seat options");
    }
    const existing = this.#engine.players.get(parsed.data.playerId);
    if (existing !== undefined) {
      if (existing.connected) {
        throw new ServerError(ErrorCode.APPLICATION_ERROR, "Player already joined");
      }
      // A dropped participant or spectator rejoins: rebind the session and
      // resume with their existing score and drawing-order slot.
      this.#rebindPlayer(existing, client, parsed.data.playerName);
      if (
        existing.playerId === this.#engine.drawerPlayerId &&
        (this.#engine.phase === "preparing" || this.#engine.phase === "drawing")
      ) {
        resumeDrawerHold(this.#engine, Date.now());
        this.#sendDrawerBriefing(existing);
      }
      this.#sync();
      this.#tryAutoStart();
      return;
    }

    if (this.#engine.phase === "lobby") {
      const rosterPlayer = this.#roster.find((player) => player.playerId === parsed.data.playerId);
      if (rosterPlayer === undefined || rosterPlayer.connectedSessionId !== null) {
        throw new ServerError(ErrorCode.APPLICATION_ERROR, "Room not joinable");
      }
      rosterPlayer.connectedSessionId = client.sessionId;
      const player = createRuntimePlayer(
        rosterPlayer.playerId,
        client.sessionId,
        parsed.data.playerName,
        rosterPlayer.isHost,
        rosterPlayer.joinedOrder,
      );
      this.#engine.players.set(player.playerId, player);
      if (player.isHost) {
        this.state.hostSessionId = client.sessionId;
      }
      this.#sync();
      if (this.#connectedRosterSize() === this.#roster.length) {
        this.#clearTransitionTimer();
        this.#tryAutoStart();
      }
      return;
    }

    // Mid-match join: server-issued spectator seat. Spectators watch and can
    // participate when the host starts the next game.
    const nextOrder = this.#nextJoinedOrder();
    const spectator = createRuntimePlayer(
      parsed.data.playerId,
      client.sessionId,
      parsed.data.playerName,
      false,
      nextOrder,
    );
    spectator.isSpectator = true;
    this.#engine.players.set(spectator.playerId, spectator);
    this.#sync();
  }

  override onDrop(client: Client): void {
    const player = this.#playerBySession(client.sessionId);
    if (player === undefined) {
      return;
    }
    player.connected = false;
    player.reconnecting = true;
    this.#onParticipantDisconnect(player, Date.now());
    this.#sync();
    void this.allowReconnection(
      client,
      LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.RECONNECT_GRACE_MS / 1000,
    ).catch(() => {
      // Grace expired or the room is closing; onLeave finalises the state.
    });
  }

  override onReconnect(client: Client): void {
    const player = this.#playerBySession(client.sessionId);
    if (player === undefined) {
      return;
    }
    player.connected = true;
    player.reconnecting = false;
    if (
      player.playerId === this.#engine.drawerPlayerId &&
      (this.#engine.phase === "preparing" || this.#engine.phase === "drawing")
    ) {
      if (this.#engine.drawerHoldUntil !== 0) {
        resumeDrawerHold(this.#engine, Date.now());
      }
      this.#sendDrawerBriefing(player);
    }
    this.#sync();
    this.#tryAutoStart();
  }

  override onLeave(client: Client): void {
    const player = this.#playerBySession(client.sessionId);
    if (player === undefined) {
      return;
    }
    this.#strokeTimestamps.delete(client.sessionId);
    this.#guessTimestamps.delete(client.sessionId);

    if (this.#engine.phase === "lobby") {
      this.#roster = this.#roster.filter(
        (rosterPlayer) => rosterPlayer.connectedSessionId !== client.sessionId,
      );
      this.#engine.players.delete(player.playerId);
      if (client.sessionId === this.state.hostSessionId) {
        this.#transferHost();
      }
      this.#sync();
      this.#tryAutoStart();
      return;
    }

    player.connected = false;
    player.reconnecting = false;
    if (player.isSpectator) {
      this.#engine.players.delete(player.playerId);
    }
    this.#onParticipantDisconnect(player, Date.now());
    if (client.sessionId === this.state.hostSessionId) {
      this.#transferHost();
    }
    this.#sync();
  }

  override onDispose(): void {
    this.#clearTransitionTimer();
    this.#clearTickTimer();
    this.#strokeTimestamps.clear();
    this.#guessTimestamps.clear();
    this.#strokePointCount = 0;
  }

  #handleStroke(client: Client, message: unknown): void {
    const parsed = liveDrawingStrokeSchema.safeParse(message);
    if (!parsed.success) {
      sendError(client, "INVALID_GAME_COMMAND", "Malformed drawing command");
      return;
    }
    const player = this.#playerBySession(client.sessionId);
    if (player === undefined) {
      sendError(client, "PLAYER_NOT_IN_ROOM", "You are not in this room");
      return;
    }
    if (!this.#canDraw(player)) {
      sendError(client, "INVALID_GAME_COMMAND", "Drawing is not active for you");
      return;
    }
    if (
      !this.#consumeRate(
        this.#strokeTimestamps,
        client.sessionId,
        Date.now(),
        LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_STROKE_MESSAGES_PER_SECOND,
      )
    ) {
      // Flood protection, not a gameplay penalty: silently ignore the excess.
      return;
    }

    const data = parsed.data;
    const incomingPointCount = data.points.length / 2;
    if (
      this.#strokePointCount + incomingPointCount >
      LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_POINTS_PER_TURN
    ) {
      return;
    }
    let stroke = [...this.state.strokes].find((entry) => entry.strokeId === data.strokeId);
    if (stroke === undefined) {
      if (
        this.state.strokes.length >= LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_STROKES_PER_TURN
      ) {
        return;
      }
      stroke = new LiveDrawingStrokeState();
      stroke.strokeId = data.strokeId;
      stroke.color = data.color;
      stroke.complete = data.complete ?? false;
      stroke.points.push(...data.points);
      this.state.strokes.push(stroke);
      this.#strokePointCount += incomingPointCount;
      return;
    }
    if (stroke.complete) {
      // Duplicate or stale stroke from an already completed gesture.
      return;
    }
    if (
      stroke.points.length + data.points.length >
      LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_POINTS_PER_STROKE * 2
    ) {
      return;
    }
    stroke.points.push(...data.points);
    this.#strokePointCount += incomingPointCount;
    if (data.complete === true) {
      stroke.complete = true;
    }
  }

  #handleUndo(client: Client, message: unknown): void {
    const parsed = liveDrawingUndoSchema.safeParse(message);
    if (!parsed.success) {
      sendError(client, "INVALID_GAME_COMMAND", "Malformed drawing command");
      return;
    }
    const player = this.#playerBySession(client.sessionId);
    if (player === undefined) {
      sendError(client, "PLAYER_NOT_IN_ROOM", "You are not in this room");
      return;
    }
    if (!this.#canDraw(player)) {
      sendError(client, "INVALID_GAME_COMMAND", "Drawing is not active for you");
      return;
    }
    if (
      !this.#consumeRate(
        this.#strokeTimestamps,
        client.sessionId,
        Date.now(),
        LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_STROKE_MESSAGES_PER_SECOND,
      )
    ) {
      // Undo shares the drawing-command budget so small valid messages cannot
      // consume unbounded server work.
      return;
    }
    for (let index = this.state.strokes.length - 1; index >= 0; index -= 1) {
      const stroke = this.state.strokes[index];
      if (stroke?.complete === true) {
        this.#strokePointCount = Math.max(0, this.#strokePointCount - stroke.points.length / 2);
        this.state.strokes.splice(index, 1);
        return;
      }
    }
  }

  #handleGuess(client: Client, message: unknown): void {
    const parsed = liveDrawingGuessSchema.safeParse(message);
    if (!parsed.success) {
      client.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guessFeedback, { kind: "invalid" });
      return;
    }
    const player = this.#playerBySession(client.sessionId);
    if (player === undefined) {
      sendError(client, "PLAYER_NOT_IN_ROOM", "You are not in this room");
      return;
    }
    if (!player.connected) {
      // A disconnected participant cannot submit guesses; ignore late queued
      // messages from a dead socket.
      return;
    }
    if (this.#engine.phase !== "drawing") {
      client.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guessFeedback, { kind: "not-active" });
      return;
    }
    if (player.isSpectator || player.playerId === this.#engine.drawerPlayerId) {
      client.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guessFeedback, { kind: "not-guesser" });
      return;
    }
    if (
      !this.#consumeRate(
        this.#guessTimestamps,
        client.sessionId,
        Date.now(),
        LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_GUESSES_PER_SECOND,
      )
    ) {
      // Flood protection, not a gameplay penalty: silently ignore the excess.
      return;
    }
    if (matchesAnswer(parsed.data.text, this.#engine.word)) {
      this.#resolveSolved(player.playerId);
      return;
    }
    client.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guessFeedback, { kind: "incorrect" });
  }

  #playAgain(client: Client): void {
    if (client.sessionId !== this.state.hostSessionId) {
      sendError(client, "NOT_HOST", "Only the host can play again");
      return;
    }
    if (this.#engine.phase !== "finished") {
      sendError(client, "GAME_NOT_RUNNING", "Play again is only available after a match");
      return;
    }
    // A new match includes every currently connected player: original
    // participants plus spectators who joined after the last game started.
    for (const [playerId, player] of [...this.#engine.players]) {
      if (!player.connected) {
        this.#engine.players.delete(playerId);
      }
    }
    const connectedCount = this.#engine.players.size;
    if (connectedCount < LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MIN_PLAYERS) {
      sendError(client, "NOT_ENOUGH_PLAYERS", "At least two connected players are required");
      return;
    }
    if (connectedCount > LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MAX_PLAYERS) {
      sendError(client, "ROOM_FULL", "This game supports up to 8 players");
      return;
    }
    startMatch(this.#engine, Date.now());
    this.#lastBriefedTurn = 0;
    void this.unlock();
    this.#sync();
  }

  #tick(): void {
    const now = Date.now();
    const engine = this.#engine;
    const drawer = engine.players.get(engine.drawerPlayerId);
    const drawerConnected = drawer?.connected === true;

    if (engine.phase === "preparing") {
      if (engine.drawerHoldUntil !== 0) {
        // The drawer is disconnected: freeze the countdown until the hold
        // expires or the drawer returns.
        if (now >= engine.drawerHoldUntil) {
          expireDrawerHold(engine, now);
        }
      } else if (drawerConnected && connectedGuesserCount(engine) === 0) {
        this.#resolveNoGuessers(now);
      } else if (now >= engine.prepareEndsAt) {
        beginDrawing(engine, now);
      }
    } else if (engine.phase === "drawing") {
      if (engine.drawerHoldUntil !== 0) {
        // Paused: the timer and letter reveals stay frozen until the drawer
        // returns or the hold expires.
        if (now >= engine.drawerHoldUntil) {
          expireDrawerHold(engine, now);
        }
      } else {
        advanceReveals(engine, now);
        if (drawerConnected && connectedGuesserCount(engine) === 0) {
          this.#resolveNoGuessers(now);
        } else if (now >= engine.drawingEndsAt) {
          this.#resolveTimeout(now);
        }
      }
    } else if (engine.phase === "result") {
      if (now >= engine.resultEndsAt) {
        advanceAfterResult(engine, now);
      }
    } else if (engine.phase === "round-summary") {
      if (now >= engine.roundSummaryEndsAt) {
        beginTurn(engine, now, engine.turnIndex);
      }
    }
    this.#sync();
  }

  #resolveSolved(winnerPlayerId: string): void {
    resolveTurn(this.#engine, Date.now(), "solved", winnerPlayerId);
    this.#sync();
  }

  #resolveTimeout(now: number): void {
    resolveTurn(this.#engine, now, "timeout", "");
  }

  #resolveNoGuessers(now: number): void {
    resolveTurn(this.#engine, now, "no-guessers", "");
  }

  #onParticipantDisconnect(player: RuntimePlayer, now: number): void {
    const engine = this.#engine;
    if (engine.phase !== "preparing" && engine.phase !== "drawing") {
      return;
    }
    if (player.playerId === engine.drawerPlayerId) {
      startDrawerHold(engine, now);
      return;
    }
    const drawer = engine.players.get(engine.drawerPlayerId);
    if (drawer?.connected === true && connectedGuesserCount(engine) === 0) {
      this.#resolveNoGuessers(now);
    }
  }

  #sendDrawerBriefing(player: RuntimePlayer): void {
    const client = this.clients.getById(player.sessionId);
    if (client === undefined) {
      return;
    }
    client.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerBriefing, {
      word: this.#engine.word,
      category: this.#engine.category,
      turnNumber: this.#engine.turnNumber,
      roundNumber: this.#engine.roundNumber,
      letterCount: [...this.#engine.word].filter((char) => /[A-Za-z]/.test(char)).length,
    });
  }

  #rebindPlayer(player: RuntimePlayer, client: Client, playerName: string): void {
    const previousSessionId = player.sessionId;
    player.sessionId = client.sessionId;
    player.name = playerName;
    player.connected = true;
    player.reconnecting = false;
    if (player.isHost) {
      this.state.hostSessionId = client.sessionId;
    }
    this.#strokeTimestamps.delete(previousSessionId);
    this.#guessTimestamps.delete(previousSessionId);
  }

  #canDraw(player: RuntimePlayer): boolean {
    return (
      this.#engine.phase === "drawing" &&
      this.#engine.drawerPlayerId === player.playerId &&
      player.connected &&
      !player.isSpectator
    );
  }

  #tryAutoStart(): void {
    const engine = this.#engine;
    if (engine.phase !== "lobby") {
      return;
    }
    const connectedRosterSize = this.#connectedRosterSize();
    if (
      connectedRosterSize < LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.MIN_PLAYERS ||
      connectedRosterSize !== this.#roster.length
    ) {
      return;
    }
    this.#clearTransitionTimer();
    startMatch(engine, Date.now());
    this.#lastBriefedTurn = 0;
    // The lobby locked this room during the transition. Unlock it now so
    // players who join by code after the game started can spectate.
    void this.unlock();
    this.#sync();
  }

  #sync(): void {
    const previousTurnNumber = this.state.turnNumber;
    syncLiveDrawingGuessingState(this.state, this.#engine);
    if (this.state.turnNumber !== previousTurnNumber) {
      this.#strokePointCount = 0;
      this.#strokeTimestamps.clear();
    }
    if (this.#engine.phase === "preparing" && this.#engine.turnNumber !== this.#lastBriefedTurn) {
      this.#lastBriefedTurn = this.#engine.turnNumber;
      const drawer = this.#engine.players.get(this.#engine.drawerPlayerId);
      if (drawer?.connected === true) {
        this.#sendDrawerBriefing(drawer);
      }
    }
  }

  #transferHost(): void {
    const remaining = [...this.#engine.players.values()]
      .filter((player) => player.connected)
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    const next = remaining[0];
    for (const player of this.#engine.players.values()) {
      player.isHost = player.playerId === next?.playerId;
    }
    this.state.hostSessionId = next?.sessionId ?? "";
  }

  #connectedRosterSize(): number {
    return this.#roster.filter((rosterPlayer) => {
      if (rosterPlayer.connectedSessionId === null) {
        return false;
      }
      return this.#engine.players.get(rosterPlayer.playerId)?.connected === true;
    }).length;
  }

  #playerBySession(sessionId: string): RuntimePlayer | undefined {
    for (const player of this.#engine.players.values()) {
      if (player.sessionId === sessionId) {
        return player;
      }
    }
    return undefined;
  }

  #nextJoinedOrder(): number {
    let next = 0;
    for (const player of this.#engine.players.values()) {
      next = Math.max(next, player.joinedOrder + 1);
    }
    return next;
  }

  #consumeRate(
    timestamps: Map<string, number[]>,
    key: string,
    now: number,
    maxPerSecond: number,
  ): boolean {
    const recent = (timestamps.get(key) ?? []).filter((timestamp) => timestamp >= now - 1_000);
    if (recent.length >= maxPerSecond) {
      timestamps.set(key, recent);
      return false;
    }
    recent.push(now);
    timestamps.set(key, recent);
    return true;
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

export type { RuntimePlayer } from "./engine.js";
