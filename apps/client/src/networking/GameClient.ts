import { Client, type Room } from "@colyseus/sdk";

import {
  type ClientGameState,
  type HopRejection,
  type HopRequest,
  normalizeRoomCode,
} from "@falling-platforms/shared";

export type StateListener = (state: ClientGameState) => void;
export type RejectionListener = (rejection: HopRejection) => void;
export type LeaveListener = () => void;
export type DroppedListener = () => void;

/**
 * Thin wrapper around the official Colyseus SDK. Keeps all transport concerns
 * in one place so scenes and UI never talk to the SDK directly.
 */
export class GameClient {
  private client: Client;
  private room: Room<ClientGameState> | null = null;
  private stateListeners = new Set<StateListener>();
  private rejectionListeners = new Set<RejectionListener>();
  private leaveListeners = new Set<LeaveListener>();
  private droppedListeners = new Set<DroppedListener>();
  private reconnectedListeners = new Set<DroppedListener>();
  private intentionalLeave = false;

  sessionId = "";
  reconnectionToken = "";

  constructor(serverUrl: string) {
    this.client = new Client(serverUrl);
  }

  get isConnected(): boolean {
    return this.room !== null;
  }

  getState(): ClientGameState | null {
    return this.room?.state ?? null;
  }

  get didLeaveIntentionally(): boolean {
    return this.intentionalLeave;
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onHopRejected(listener: RejectionListener): () => void {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
  }

  onLeave(listener: LeaveListener): () => void {
    this.leaveListeners.add(listener);
    return () => this.leaveListeners.delete(listener);
  }

  /** Fires when the connection drops and automatic reconnection begins. */
  onDropped(listener: DroppedListener): () => void {
    this.droppedListeners.add(listener);
    return () => this.droppedListeners.delete(listener);
  }

  /** Fires when the SDK successfully reconnects after a drop. */
  onReconnected(listener: DroppedListener): () => void {
    this.reconnectedListeners.add(listener);
    return () => this.reconnectedListeners.delete(listener);
  }

  async createRoom(name: string): Promise<void> {
    const room = await this.client.create<ClientGameState>("falling_platforms", { name });
    this.attach(room);
  }

  async joinRoom(name: string, code: string): Promise<void> {
    const room = await this.client.joinById<ClientGameState>(normalizeRoomCode(code), { name });
    this.attach(room);
  }

  async reconnect(token: string): Promise<void> {
    const room = await this.client.reconnect<ClientGameState>(token);
    this.attach(room);
  }

  sendHop(request: HopRequest): void {
    this.room?.send("hop", request);
  }

  startMatch(): void {
    this.room?.send("start", {});
  }

  leave(): Promise<number> {
    if (!this.room) {
      return Promise.resolve(0);
    }
    this.intentionalLeave = true;
    return this.room.leave();
  }

  private attach(room: Room<ClientGameState>): void {
    this.intentionalLeave = false;
    this.room = room;
    this.sessionId = room.sessionId;
    this.reconnectionToken = room.reconnectionToken;
    // Recover from drops even in the first seconds of the room's life (the SDK
    // default disables automatic reconnection for the first five seconds).
    room.reconnection.minUptime = 0;

    room.onStateChange((state) => {
      for (const listener of this.stateListeners) {
        listener(state);
      }
    });
    room.onMessage("hop-rejected", (rejection: HopRejection) => {
      for (const listener of this.rejectionListeners) {
        listener(rejection);
      }
    });
    room.onDrop(() => {
      for (const listener of this.droppedListeners) {
        listener();
      }
    });
    room.onReconnect(() => {
      for (const listener of this.reconnectedListeners) {
        listener();
      }
    });
    room.onLeave(() => {
      this.room = null;
      for (const listener of this.leaveListeners) {
        listener();
      }
    });
  }
}
