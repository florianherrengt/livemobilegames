import { Client as ColyseusClient, type Room } from "@colyseus/sdk";
import { ErrorCode } from "@colyseus/shared-types";

import {
  type CommandResultPayload,
  commandResultPayloadSchema,
  MESSAGE,
  normalizeRoomCode,
  type PlatformErrorPayload,
  type PlatformOperation,
  type ProtocolError,
  platformErrorPayloadSchema,
  protocolError,
  type RoomStatus,
  type StoredConnection,
  timeSyncResponseSchema,
} from "@falling-platforms/platform-shared";

import { estimateServerTime, smoothOffset } from "./clock-sync.js";
import { createRequestId } from "./request-id.js";
import { LocalStorageSessionStorage, type SessionStorage } from "./session-storage.js";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface MultiplayerClientOptions {
  serverUrl: string;
  storage?: SessionStorage;
  storageKey?: string;
  commandTimeoutMs?: number;
}

export interface MembershipInfo {
  sessionId: string;
  displayName: string;
  roomId: string;
  roomName: string;
}

export interface LobbyPlayerSnapshot {
  sessionId: string;
  name: string;
  connectionStatus: ConnectionStatus;
  isHost: boolean;
  isReady: boolean;
  joinedOrder: number;
}

export interface LobbySnapshot {
  roomCode: string;
  gameId: string;
  status: RoomStatus;
  hostSessionId: string;
  minPlayers: number;
  requiresReady: boolean;
  players: LobbyPlayerSnapshot[];
  selfSessionId: string;
  isHost: boolean;
  allReady: boolean;
  canStart: boolean;
}

interface LobbyStateLike {
  roomCode: string;
  gameId: string;
  status: RoomStatus;
  hostSessionId: string;
  minPlayers: number;
  requiresReady: boolean;
  players: Map<string, LobbyPlayerSnapshot>;
}

interface PendingRequest {
  resolve: () => void;
  reject: (error: ProtocolError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const TIME_SYNC_TIMEOUT_MS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapJoinError(error: unknown, operation: PlatformOperation): ProtocolError {
  if (isRecord(error) && typeof error.message === "string") {
    try {
      const parsed: unknown = JSON.parse(error.message);
      if (isRecord(parsed) && typeof parsed.code === "string") {
        return { code: parsed.code as ProtocolError["code"], message: String(parsed.message) };
      }
    } catch {
      // Not a structured message; fall through to code mapping.
    }
  }
  const code = isRecord(error) ? error.code : undefined;
  switch (code) {
    case ErrorCode.MATCHMAKE_NO_HANDLER:
      return protocolError("ROOM_NOT_FOUND", "The room or game does not exist");
    case ErrorCode.MATCHMAKE_INVALID_ROOM_ID:
      return protocolError("ROOM_NOT_FOUND", "The room does not exist");
    case ErrorCode.MATCHMAKE_EXPIRED:
      return protocolError(
        operation === "room.join" ? "ROOM_NOT_FOUND" : "UNAUTHENTICATED",
        operation === "room.join"
          ? "The room no longer exists"
          : "The reconnection token is invalid or expired",
      );
    case ErrorCode.AUTH_FAILED:
      return protocolError("UNAUTHENTICATED", "Authentication failed");
    case ErrorCode.INVALID_PAYLOAD:
      return protocolError("INVALID_REQUEST", "The server rejected the request payload");
    case ErrorCode.APPLICATION_ERROR:
      return protocolError("INVALID_REQUEST", "The server rejected the request");
    default:
      break;
  }
  if (isRecord(error) && typeof error.message === "string") {
    const message = error.message.toLowerCase();
    if (message.includes("full")) {
      return protocolError("ROOM_FULL", "The room is full");
    }
    if (message.includes("reconnection") || message.includes("expired")) {
      return protocolError("UNAUTHENTICATED", "The reconnection token is invalid or expired");
    }
  }
  return protocolError("INTERNAL_ERROR", "Could not reach the game server");
}

/**
 * Framework-independent client for the multiplayer platform. Wraps the
 * official Colyseus SDK; exposes typed lobby commands, connection state,
 * reconnection records and server clock estimation.
 */
export class MultiplayerClient<TState = unknown, TCommand = unknown> {
  private readonly colyseus: ColyseusClient;
  private readonly storage: SessionStorage;
  private readonly serverUrl: string;
  private readonly commandTimeoutMs: number;

  private room: Room<unknown, TState> | null = null;
  private displayName = "";
  private status: ConnectionStatus = "idle";
  private offset: number | null = null;

  private readonly stateListeners = new Set<(state: TState) => void>();
  private readonly connectionListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly errorListeners = new Set<(error: PlatformErrorPayload) => void>();
  private readonly messageListeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly timeSyncWaiters = new Map<string, (serverTime: number | null) => void>();

  constructor(options: MultiplayerClientOptions) {
    this.serverUrl = options.serverUrl;
    this.storage =
      options.storage ??
      new LocalStorageSessionStorage(options.storageKey ?? "multiplayer:connection");
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.colyseus = new ColyseusClient(options.serverUrl);
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  getState(): TState | null {
    return this.room?.state ?? null;
  }

  getMembership(): MembershipInfo | null {
    if (!this.room) {
      return null;
    }
    return {
      sessionId: this.room.sessionId,
      displayName: this.displayName,
      roomId: this.room.roomId,
      roomName: this.room.name,
    };
  }

  getReconnectionToken(): string | null {
    return this.room?.reconnectionToken ?? null;
  }

  getLobbySnapshot(): LobbySnapshot | null {
    if (!this.room) {
      return null;
    }
    const state = this.room.state as unknown as LobbyStateLike | undefined;
    if (state?.players === undefined) {
      return null;
    }
    const selfSessionId = this.room.sessionId;
    const players = [...state.players.entries()]
      .map(([sessionId, player]) => ({
        sessionId,
        name: player.name,
        connectionStatus: player.connectionStatus,
        isHost: player.isHost,
        isReady: player.isReady,
        joinedOrder: player.joinedOrder,
      }))
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    const allReady = players.every((player) => player.isReady);
    return {
      roomCode: state.roomCode,
      gameId: state.gameId,
      status: state.status,
      hostSessionId: state.hostSessionId,
      minPlayers: state.minPlayers,
      requiresReady: state.requiresReady,
      players,
      selfSessionId,
      isHost: state.hostSessionId === selfSessionId,
      allReady,
      canStart:
        state.status === "lobby" &&
        state.hostSessionId === selfSessionId &&
        players.length >= state.minPlayers &&
        (!state.requiresReady || allReady),
    };
  }

  getEstimatedServerTime(): number | null {
    return estimateServerTime(this.offset);
  }

  onStateChange(listener: (state: TState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onConnectionChange(listener: (status: ConnectionStatus) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onError(listener: (payload: PlatformErrorPayload) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onMessage<T>(type: string, listener: (payload: T) => void): () => void {
    let listeners = this.messageListeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.messageListeners.set(type, listeners);
    }
    listeners.add(listener as (payload: unknown) => void);
    return () => listeners?.delete(listener as (payload: unknown) => void);
  }

  async createRoom(options: { gameId: string; name: string }): Promise<MembershipInfo> {
    this.setStatus("connecting");
    try {
      const room = await this.colyseus.create<TState>(options.gameId, { name: options.name });
      return this.attach(room, options.name);
    } catch (error: unknown) {
      this.setStatus("disconnected");
      throw mapJoinError(error, "room.create");
    }
  }

  async joinRoom(options: { roomCode: string; name: string }): Promise<MembershipInfo> {
    this.setStatus("connecting");
    try {
      const room = await this.colyseus.joinById<TState>(normalizeRoomCode(options.roomCode), {
        name: options.name,
      });
      return this.attach(room, options.name);
    } catch (error: unknown) {
      this.setStatus("disconnected");
      throw mapJoinError(error, "room.join");
    }
  }

  async reconnect(token?: string): Promise<MembershipInfo> {
    const stored = this.storage.load();
    const reconnectToken = token ?? stored?.reconnectToken;
    if (!reconnectToken) {
      throw protocolError("UNAUTHENTICATED", "No stored reconnection token");
    }
    this.setStatus("connecting");
    try {
      const room = await this.colyseus.reconnect<TState>(reconnectToken);
      return this.attach(room, this.displayName);
    } catch (error: unknown) {
      this.storage.clear();
      this.setStatus("disconnected");
      throw mapJoinError(error, "room.join");
    }
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (room) {
      await room.leave();
    }
  }

  setReady(ready: boolean): Promise<void> {
    return this.request(MESSAGE.setReady, { ready });
  }

  startGame(): Promise<void> {
    return this.request(MESSAGE.start, {});
  }

  playAgain(): Promise<void> {
    return this.request(MESSAGE.playAgain, {});
  }

  sendGameCommand(
    command: TCommand,
    options?: { requestId?: string; timeoutMs?: number },
  ): Promise<void> | void {
    if (!options?.requestId) {
      this.rawSend(MESSAGE.gameCommand, { command });
      return;
    }
    return this.request(
      MESSAGE.gameCommand,
      { command },
      {
        requestId: options.requestId,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      },
    );
  }

  send(type: string, payload: unknown): void {
    this.rawSend(type, payload);
  }

  async syncTime(): Promise<number | null> {
    if (!this.room) {
      return null;
    }
    const sentAt = Date.now();
    const requestId = createRequestId();
    const serverTime = await new Promise<number | null>((resolve) => {
      this.timeSyncWaiters.set(requestId, (value) => resolve(value));
      const timer = setTimeout(() => {
        this.timeSyncWaiters.delete(requestId);
        resolve(null);
      }, TIME_SYNC_TIMEOUT_MS);
      this.rawSend(MESSAGE.timeSync, { requestId, sentAt });
      if (!this.room) {
        clearTimeout(timer);
      }
    });
    this.timeSyncWaiters.delete(requestId);
    if (serverTime === null) {
      return this.getEstimatedServerTime();
    }
    const receivedAt = Date.now();
    const rtt = receivedAt - sentAt;
    if (rtt <= 1_000) {
      const sample = serverTime - (sentAt + receivedAt) / 2;
      this.offset = smoothOffset(this.offset, sample);
    }
    return this.getEstimatedServerTime();
  }

  dispose(): void {
    this.stateListeners.clear();
    this.connectionListeners.clear();
    this.errorListeners.clear();
    this.messageListeners.clear();
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(protocolError("INTERNAL_ERROR", "Client was disposed"));
    }
    this.pendingRequests.clear();
    if (this.room) {
      this.room.removeAllListeners();
      this.room = null;
    }
  }

  private attach(room: Room<unknown, TState>, displayName: string): MembershipInfo {
    this.detach();
    this.room = room;
    this.displayName = displayName;
    room.reconnection.minUptime = 0;

    // Wire every listener before the connection is exposed as restored.
    room.onStateChange((state: TState) => {
      for (const listener of this.stateListeners) {
        listener(state);
      }
    });
    room.onMessage("*", (messageType: string | number, payload: unknown) => {
      this.handleMessage(String(messageType), payload);
    });
    room.onDrop(() => {
      this.failAllPending(protocolError("INTERNAL_ERROR", "Connection lost"));
      this.setStatus("reconnecting");
    });
    room.onReconnect(() => {
      this.persistConnection();
      this.setStatus("connected");
      void this.syncTime();
    });
    room.onLeave(() => {
      this.failAllPending(protocolError("INTERNAL_ERROR", "Connection lost"));
      this.storage.clear();
      this.room = null;
      this.setStatus("disconnected");
    });

    this.persistConnection();
    this.setStatus("connected");
    void this.syncTime();
    return this.getMembership() as MembershipInfo;
  }

  private detach(): void {
    if (this.room) {
      this.room.removeAllListeners();
    }
    this.failAllPending(protocolError("INTERNAL_ERROR", "Connection replaced"));
    this.room = null;
  }

  private persistConnection(): void {
    const room = this.room;
    if (!room) {
      return;
    }
    const record: StoredConnection = {
      serverUrl: this.serverUrl,
      roomId: room.roomId,
      roomName: room.name,
      reconnectToken: room.reconnectionToken,
      updatedAt: Date.now(),
    };
    this.storage.save(record);
  }

  private request(
    type: string,
    payload: Record<string, unknown>,
    options?: { requestId?: string; timeoutMs?: number },
  ): Promise<void> {
    if (!this.room) {
      return Promise.reject(protocolError("INTERNAL_ERROR", "Not connected to a room"));
    }
    const requestId = options?.requestId ?? createRequestId();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(protocolError("REQUEST_TIMEOUT", "The server did not respond in time"));
      }, options?.timeoutMs ?? this.commandTimeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error: ProtocolError) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
      this.rawSend(type, { ...payload, requestId });
    });
  }

  /**
   * The Colyseus SDK types messages through generated room type maps; this
   * platform deliberately uses dynamic message types, so the SDK send method
   * is used through its permissive runtime signature.
   */
  private rawSend(type: string, payload: unknown): void {
    const room = this.room;
    if (!room) {
      return;
    }
    const send = room.send.bind(room) as unknown as (
      messageType: string,
      message?: unknown,
    ) => void;
    send(type, payload);
  }

  private handleMessage(messageType: string, payload: unknown): void {
    if (messageType === MESSAGE.commandResult) {
      const parsed = commandResultPayloadSchema.safeParse(payload);
      if (parsed.success) {
        this.resolveCommandResult(parsed.data);
      }
      return;
    }
    if (messageType === MESSAGE.timeSync) {
      const parsed = timeSyncResponseSchema.safeParse(payload);
      if (parsed.success) {
        const waiter = this.timeSyncWaiters.get(parsed.data.requestId);
        if (waiter) {
          waiter(parsed.data.serverTime);
        }
      }
      return;
    }
    if (messageType === MESSAGE.error) {
      const parsed = platformErrorPayloadSchema.safeParse(payload);
      if (parsed.success) {
        for (const listener of this.errorListeners) {
          listener(parsed.data);
        }
      }
      return;
    }
    const listeners = this.messageListeners.get(messageType);
    if (listeners) {
      for (const listener of listeners) {
        listener(payload);
      }
    }
  }

  private resolveCommandResult(result: CommandResultPayload): void {
    const pending = this.pendingRequests.get(result.requestId);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(result.requestId);
    if (result.ok) {
      pending.resolve();
    } else {
      pending.reject(result.error);
    }
  }

  private failAllPending(error: ProtocolError): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    for (const listener of this.connectionListeners) {
      listener(status);
    }
  }
}
