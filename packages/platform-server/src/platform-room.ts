import type { MapSchema } from "@colyseus/schema";
import {
  matchResultToState,
  type PlatformPlayerState,
  type PlatformState,
} from "@falling-platforms/platform-schema";
import {
  type CommandResult,
  type CommandResultPayload,
  type GameConfig,
  gameCommandSchema,
  joinOptionsSchema,
  type MatchResult,
  MESSAGE,
  type PlatformErrorPayload,
  type PlatformOperation,
  type ProtocolError,
  playAgainSchema,
  protocolError,
  setReadySchema,
  startSchema,
  timeSyncRequestSchema,
} from "@falling-platforms/platform-shared";
import { type Client, CloseCode, ErrorCode, Room, ServerError } from "colyseus";
import type { z } from "zod";

import type { GameContext, GamePlayerRef } from "./game-context.js";
import { assertValidGameDefinition, type GameDefinition } from "./game-definition.js";
import { buildLeaderboard, validateMatchResult } from "./leaderboard.js";
import { type LobbyPlayerLike, selectHost, startCommandError } from "./lobby-rules.js";
import { createPlatformLogger, type Logger } from "./logger.js";
import { RoomCodeAllocator } from "./room-code-allocator.js";
import { SerialQueue } from "./serial-queue.js";

export interface PlatformRoomOptions {
  roomCodeLength?: number;
  roomCodeAlphabet?: string;
  roomCodeMaxAttempts?: number;
  roomCodeClaimTtlMs: number;
  maxMessagesPerSecond?: number;
  tickIntervalMs?: number;
  finishedRoomTimeoutMs: number;
  maxRoomLifetimeMs: number;
  now?: () => number;
  logger?: Logger;
  queueWarnDepth?: number;
  queueWarnDurationMs?: number;
}

type RoomTimer = ReturnType<Room["clock"]["setTimeout"]>;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function playerRef(sessionId: string, player: PlatformPlayerState): GamePlayerRef {
  return {
    sessionId,
    name: player.name,
    connectionStatus: player.connectionStatus,
    isHost: player.isHost,
    isReady: player.isReady,
    joinedAt: player.joinedAt,
    joinedOrder: player.joinedOrder,
  };
}

/**
 * The platform-owned Colyseus room. Owns room codes, player presence, host and
 * ready state, start/play-again permissions, reconnection, typed commands and
 * errors, timers and match results. Game rules live behind GameDefinition.
 */
export class PlatformRoom<
    TState extends PlatformState & { players: MapSchema<TPlayerState> },
    TPlayerState extends PlatformPlayerState,
    TCommand,
  >
  extends Room<{ state: TState }>
  implements GameContext
{
  override state!: TState;
  override maxClients: number;
  override maxMessagesPerSecond: number;

  private readonly game: GameDefinition<TState, TPlayerState, TCommand>;
  private readonly queue: SerialQueue;
  private readonly nowFn: () => number;
  private readonly options: {
    roomCodeLength: number;
    roomCodeAlphabet: string | undefined;
    roomCodeMaxAttempts: number;
    roomCodeClaimTtlMs: number;
    tickIntervalMs: number;
    finishedRoomTimeoutMs: number;
    maxRoomLifetimeMs: number;
  };

  private allocator: RoomCodeAllocator | null = null;
  private readonly timers = new Map<string, RoomTimer>();
  private finishedDisposeTimer: RoomTimer | null = null;
  private lifetimeDisposeTimer: RoomTimer | null = null;
  private readonly finalizedLeaves = new Set<string>();
  private nextJoinedOrder = 0;
  private roomLogger: Logger;
  private disposed = false;

  constructor(game: GameDefinition<TState, TPlayerState, TCommand>, options: PlatformRoomOptions) {
    super();
    const validationError = assertValidGameDefinition(game);
    if (validationError) {
      throw new Error(`Invalid game definition "${game.id}": ${validationError.message}`);
    }
    this.game = game;
    this.maxClients = game.config.maxPlayers;
    this.maxMessagesPerSecond = options.maxMessagesPerSecond ?? 60;
    this.nowFn = options.now ?? (() => Date.now());
    this.options = {
      roomCodeLength: options.roomCodeLength ?? 5,
      roomCodeAlphabet: options.roomCodeAlphabet,
      roomCodeMaxAttempts: options.roomCodeMaxAttempts ?? 100,
      roomCodeClaimTtlMs: options.roomCodeClaimTtlMs,
      tickIntervalMs: options.tickIntervalMs ?? 50,
      finishedRoomTimeoutMs: options.finishedRoomTimeoutMs,
      maxRoomLifetimeMs: options.maxRoomLifetimeMs,
    };
    const baseLogger = options.logger ?? createPlatformLogger("info");
    this.roomLogger = baseLogger.child({ gameId: game.id });
    this.queue = new SerialQueue({
      warnDepth: options.queueWarnDepth ?? 20,
      warnDurationMs: options.queueWarnDurationMs ?? 100,
      logger: this.roomLogger,
    });
  }

  override async onCreate(_options: unknown): Promise<void> {
    const allocator = new RoomCodeAllocator(this.presence, {
      ...(this.options.roomCodeAlphabet ? { alphabet: this.options.roomCodeAlphabet } : {}),
      length: this.options.roomCodeLength,
      maxAttempts: this.options.roomCodeMaxAttempts,
      claimTtlMs: this.options.roomCodeClaimTtlMs,
    });
    const code = await allocator.claim();
    this.allocator = allocator;
    this.roomId = code;
    this.roomLogger = this.roomLogger.child({ roomId: code });

    this.state = this.game.createState(this);
    this.state.roomCode = code;
    this.state.gameId = this.game.id;
    this.state.createdAt = this.nowFn();
    this.state.minPlayers = this.game.config.minPlayers;
    this.state.requiresReady = this.game.config.requiresReady;

    if (this.game.onTick) {
      this.setSimulationInterval(() => this.runSimulationTick(), this.options.tickIntervalMs);
    }
    if (this.options.maxRoomLifetimeMs > 0) {
      this.lifetimeDisposeTimer = this.clock.setTimeout(() => {
        void this.queue
          .enqueue(() => this.closeRoom("max-lifetime"))
          .catch((error: unknown) => this.failRoom(error));
      }, this.options.maxRoomLifetimeMs);
    }
    this.roomLogger.info({}, "room created");
  }

  override async onJoin(client: Client, options: unknown): Promise<void> {
    const parsed = joinOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        JSON.stringify(protocolError("INVALID_REQUEST", "Invalid join options")),
      );
    }
    if (this.state.status !== "lobby" && !this.game.config.allowJoinAfterStart) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        JSON.stringify(
          protocolError("ROOM_NOT_JOINABLE", "This room is not joinable at its current stage"),
        ),
      );
    }
    try {
      await this.queue.enqueue(() => {
        const player = this.game.createPlayerState(this, client.sessionId);
        player.name = parsed.data.name;
        player.connectionStatus = "connected";
        player.isHost = this.state.players.size === 0;
        player.isReady = false;
        player.joinedAt = this.nowFn();
        player.joinedOrder = this.nextJoinedOrder;
        this.nextJoinedOrder += 1;
        this.state.players.set(client.sessionId, player);
        if (player.isHost) {
          this.state.hostSessionId = client.sessionId;
        }
        this.callGameHook(this.game.onJoin, [this, this.state, client.sessionId], "onJoin");
        this.roomLogger.info({ sessionId: client.sessionId }, "player joined");
      });
    } catch (error: unknown) {
      this.failRoom(error);
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Failed to join the room");
    }
  }

  override async onDrop(client: Client): Promise<void> {
    if (this.finalizedLeaves.has(client.sessionId)) {
      return;
    }
    // Only the immediate presence mutation is queued. The reconnection wait
    // happens outside the serial queue; Colyseus calls onReconnect/onLeave
    // afterwards, and each of those enqueues its own short mutation.
    await this.queue
      .enqueue(() => {
        const player = this.state.players.get(client.sessionId);
        if (!player) {
          return;
        }
        player.connectionStatus = "reconnecting";
        this.callGameHook(this.game.onDrop, [this, this.state, client.sessionId], "onDrop");
        this.roomLogger.info({ sessionId: client.sessionId }, "player connection dropped");
      })
      .catch((error: unknown) => this.failRoom(error));
    try {
      await this.allowReconnection(client, this.game.config.reconnectGraceMs / 1000);
    } catch {
      // Grace expired or the room is closing: onLeave finalises the removal.
    }
  }

  override onReconnect(client: Client): void {
    if (this.finalizedLeaves.has(client.sessionId)) {
      return;
    }
    void this.queue
      .enqueue(() => {
        const player = this.state.players.get(client.sessionId);
        if (!player) {
          return;
        }
        player.connectionStatus = "connected";
        this.callGameHook(
          this.game.onReconnect,
          [this, this.state, client.sessionId],
          "onReconnect",
        );
        this.roomLogger.info({ sessionId: client.sessionId }, "player reconnected");
      })
      .catch((error: unknown) => this.failRoom(error));
  }

  override onLeave(client: Client): void {
    if (this.finalizedLeaves.has(client.sessionId)) {
      return;
    }
    this.finalizedLeaves.add(client.sessionId);
    void this.queue
      .enqueue(() => this.removePlayer(client.sessionId))
      .catch((error: unknown) => this.failRoom(error));
  }

  override async onDispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.allocator) {
      try {
        await this.allocator.release(this.roomId);
      } catch (error: unknown) {
        this.roomLogger.error({ err: error }, "failed to release room code");
      }
    }
    this.finishedDisposeTimer?.clear();
    this.finishedDisposeTimer = null;
    this.lifetimeDisposeTimer?.clear();
    this.lifetimeDisposeTimer = null;
    for (const timer of this.timers.values()) {
      timer.clear();
    }
    this.timers.clear();
    this.queue.dispose();
    try {
      this.callGameHook(this.game.onDispose, [this, this.state], "onDispose");
    } catch (error: unknown) {
      this.roomLogger.error({ err: error }, "game onDispose hook failed");
    }
    this.roomLogger.info({}, "room disposed");
  }

  override messages = {
    [MESSAGE.setReady]: (client: Client, message: unknown) =>
      this.onLobbyCommand(client, "room.set-ready", setReadySchema, message, (payload) =>
        this.applySetReady(client, payload),
      ),
    [MESSAGE.start]: (client: Client, message: unknown) =>
      this.onLobbyCommand(client, "room.start", startSchema, message, (payload) =>
        this.applyStart(client, payload),
      ),
    [MESSAGE.playAgain]: (client: Client, message: unknown) =>
      this.onLobbyCommand(client, "room.play-again", playAgainSchema, message, (payload) =>
        this.applyPlayAgain(client, payload),
      ),
    [MESSAGE.gameCommand]: (client: Client, message: unknown) =>
      this.onGameCommand(client, message),
    [MESSAGE.timeSync]: (client: Client, message: unknown) => this.onTimeSync(client, message),
  };

  // GameContext

  now(): number {
    return this.nowFn();
  }

  get roomCode(): string {
    return this.state.roomCode;
  }

  get gameId(): string {
    return this.game.id;
  }

  getPlayers(): readonly GamePlayerRef[] {
    return [...this.state.players.entries()].map(([sessionId, player]) =>
      playerRef(sessionId, player),
    );
  }

  getPlayer(sessionId: string): GamePlayerRef | undefined {
    const player = this.state.players.get(sessionId);
    return player ? playerRef(sessionId, player) : undefined;
  }

  emitToPlayer(sessionId: string, type: string, payload: unknown): void {
    const client = this.clients.getById(sessionId);
    if (client) {
      client.send(type, payload);
    }
  }

  emitToRoom(type: string, payload: unknown): void {
    this.broadcast(type, payload);
  }

  scheduleIn(scheduleId: string, delayMs: number, callback: () => void): void {
    this.cancelSchedule(scheduleId);
    const timer = this.clock.setTimeout(() => {
      this.timers.delete(scheduleId);
      void this.queue
        .enqueue(() => {
          const result = callback();
          if (isThenable(result)) {
            throw new Error("Game scheduled callbacks must be synchronous");
          }
        })
        .catch((error: unknown) => this.failRoom(error));
    }, delayMs);
    this.timers.set(scheduleId, timer);
  }

  scheduleAt(scheduleId: string, runAt: number, callback: () => void): void {
    this.scheduleIn(scheduleId, Math.max(0, runAt - this.nowFn()), callback);
  }

  cancelSchedule(scheduleId: string): void {
    const timer = this.timers.get(scheduleId);
    if (timer) {
      timer.clear();
      this.timers.delete(scheduleId);
    }
  }

  finishMatch(result: MatchResult): void {
    const error = validateMatchResult(result, new Set(this.state.players.keys()));
    if (error) {
      throw new Error(`Game produced an invalid match result: ${error.code}`);
    }
    this.state.status = "finished";
    this.state.result = matchResultToState(result);
    if (this.options.finishedRoomTimeoutMs > 0) {
      this.finishedDisposeTimer = this.clock.setTimeout(() => {
        void this.queue
          .enqueue(() => this.closeRoom("finished-timeout"))
          .catch((error: unknown) => this.failRoom(error));
      }, this.options.finishedRoomTimeoutMs);
    }
    this.broadcast(MESSAGE.matchFinished, { result });
    this.roomLogger.info({ winnerSessionIds: result.winnerSessionIds }, "match finished");
  }

  returnToLobby(): void {
    void this.queue
      .enqueue(() => this.returnToLobbyMutation())
      .catch((error: unknown) => this.failRoom(error));
  }

  private returnToLobbyMutation(): void {
    if (this.finishedDisposeTimer) {
      this.finishedDisposeTimer.clear();
      this.finishedDisposeTimer = null;
    }
    this.state.status = "lobby";
    this.state.result = null;
    for (const player of this.state.players.values()) {
      player.isReady = false;
    }
    this.callGameHook(this.game.onReset, [this, this.state], "onReset");
    this.roomLogger.info({}, "room returned to lobby");
  }

  private removePlayer(sessionId: string): void {
    const wasHost = this.state.hostSessionId === sessionId;
    const removed = this.state.players.delete(sessionId);
    if (!removed) {
      return;
    }
    this.callGameHook(this.game.onRemoved, [this, this.state, sessionId], "onRemoved");
    if (wasHost) {
      const nextHost = selectHost(
        [...this.state.players.entries()].map(
          ([id, player]) => playerRef(id, player) as LobbyPlayerLike,
        ),
      );
      this.state.hostSessionId = nextHost ?? "";
      if (nextHost) {
        this.roomLogger.info({ hostSessionId: nextHost }, "host transferred");
      }
    }
    this.roomLogger.info({ sessionId }, "player permanently left");
  }

  private onLobbyCommand<S extends { requestId: string }>(
    client: Client,
    operation: PlatformOperation,
    schema: z.ZodType<S>,
    message: unknown,
    apply: (payload: S) => CommandResult,
  ): void {
    const parsed = schema.safeParse(message);
    if (!parsed.success) {
      client.send(MESSAGE.error, {
        operation,
        error: protocolError("INVALID_REQUEST", "Malformed request"),
      } satisfies PlatformErrorPayload);
      return;
    }
    const { requestId } = parsed.data;
    void this.queue
      .enqueue(() => {
        const result = apply(parsed.data);
        this.sendCommandResult(client, operation, requestId, result);
      })
      .catch((error: unknown) => this.failRoom(error));
  }

  private sendCommandResult(
    client: Client,
    operation: PlatformOperation,
    requestId: string,
    result: CommandResult,
  ): void {
    const payload: CommandResultPayload = result.ok
      ? {
          requestId,
          operation,
          ok: true,
          ...(result.data !== undefined ? { data: result.data } : {}),
        }
      : { requestId, operation, ok: false, error: result.error };
    client.send(MESSAGE.commandResult, payload);
  }

  private applySetReady(client: Client, payload: { ready: boolean }): CommandResult {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return { ok: false, error: protocolError("PLAYER_NOT_IN_ROOM", "You are not in this room") };
    }
    if (this.state.status !== "lobby") {
      return {
        ok: false,
        error: protocolError("GAME_ALREADY_STARTED", "Ready state can only change in the lobby"),
      };
    }
    player.isReady = payload.ready;
    return { ok: true };
  }

  private applyStart(client: Client, _payload: { requestId: string }): CommandResult {
    const error = startCommandError(
      this.game.config,
      this.state.status,
      client.sessionId,
      this.state.hostSessionId,
      this.lobbyPlayers(),
    );
    if (error) {
      return { ok: false, error };
    }
    this.state.status = "running";
    this.callGameHook(this.game.onStart, [this, this.state], "onStart");
    this.roomLogger.info({}, "game started");
    return { ok: true };
  }

  private applyPlayAgain(client: Client, _payload: { requestId: string }): CommandResult {
    if (client.sessionId !== this.state.hostSessionId) {
      return { ok: false, error: protocolError("NOT_HOST", "Only the host can play again") };
    }
    if (this.state.status !== "finished") {
      return {
        ok: false,
        error: protocolError("GAME_NOT_RUNNING", "Play again is only available after a match"),
      };
    }
    this.returnToLobbyMutation();
    return { ok: true };
  }

  private onGameCommand(client: Client, message: unknown): void {
    const parsed = gameCommandSchema.safeParse(message);
    if (!parsed.success) {
      client.send(MESSAGE.error, {
        operation: "game.command",
        error: protocolError("INVALID_REQUEST", "Malformed game command"),
      } satisfies PlatformErrorPayload);
      return;
    }
    const { command, requestId } = parsed.data;
    void this.queue
      .enqueue(() => {
        const player = this.state.players.get(client.sessionId);
        if (!player) {
          this.replyCommandFailure(client, requestId, "PLAYER_NOT_IN_ROOM");
          return;
        }
        if (this.state.status !== "running") {
          this.replyCommandFailure(client, requestId, "GAME_NOT_RUNNING");
          return;
        }
        const parsedCommand = this.game.commandSchema.safeParse(command);
        if (!parsedCommand.success) {
          this.replyCommandFailure(client, requestId, "INVALID_GAME_COMMAND");
          return;
        }
        const result = this.game.onCommand(this, this.state, client.sessionId, parsedCommand.data);
        if (isThenable(result)) {
          throw new Error("Game onCommand hook must be synchronous");
        }
        const outcome = result ?? { ok: true as const };
        if (requestId) {
          this.sendCommandResult(client, "game.command", requestId, outcome);
        }
        // Fire-and-forget commands intentionally receive no command result;
        // expected rejections are not transmitted for them.
      })
      .catch((error: unknown) => this.failRoom(error));
  }

  private replyCommandFailure(
    client: Client,
    requestId: string | undefined,
    code: ProtocolError["code"],
  ): void {
    const error = protocolError(code, "Game command rejected");
    if (requestId) {
      this.sendCommandResult(client, "game.command", requestId, { ok: false, error });
    }
  }

  private onTimeSync(client: Client, message: unknown): void {
    const parsed = timeSyncRequestSchema.safeParse(message);
    if (!parsed.success) {
      return;
    }
    client.send(MESSAGE.timeSync, {
      requestId: parsed.data.requestId,
      sentAt: parsed.data.sentAt,
      serverTime: this.nowFn(),
    });
  }

  private runSimulationTick(): void {
    if (!this.game.onTick) {
      return;
    }
    try {
      this.callGameHook(this.game.onTick, [this, this.state, this.nowFn()], "onTick");
    } catch (error: unknown) {
      this.failRoom(error);
    }
  }

  private callGameHook<A extends unknown[]>(
    hook: ((...args: A) => unknown) | undefined,
    args: A,
    label: string,
  ): void {
    if (!hook) {
      return;
    }
    const result = hook(...args);
    if (isThenable(result)) {
      throw new Error(`Game ${label} hook must be synchronous`);
    }
  }

  private lobbyPlayers(): LobbyPlayerLike[] {
    return [...this.state.players.entries()].map(([sessionId, player]) => ({
      sessionId,
      connectionStatus: player.connectionStatus,
      isReady: player.isReady,
      joinedOrder: player.joinedOrder,
    }));
  }

  private closeRoom(reason: string): void {
    if (this.state.status === "closed") {
      return;
    }
    this.state.status = "closed";
    this.roomLogger.info({ reason }, "closing room");
    void this.disconnect();
  }

  private failRoom(error: unknown): void {
    this.roomLogger.error({ err: error }, "unexpected room error; closing room");
    try {
      this.broadcast(MESSAGE.error, {
        operation: "room.internal",
        error: protocolError("INTERNAL_ERROR", "The room encountered an internal error"),
      } satisfies PlatformErrorPayload);
    } catch {
      // The room may already be closing.
    }
    void this.disconnect(CloseCode.WITH_ERROR);
  }
}

export type { GameConfig };
export { buildLeaderboard, validateMatchResult };
