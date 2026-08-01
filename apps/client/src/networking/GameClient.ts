import { type ConnectionStatus, MultiplayerClient } from "@falling-platforms/client-sdk";
import type {
  ClientGameState,
  FallingPlatformsCommand,
  HopRejection,
  HopRequest,
} from "@falling-platforms/shared";

export type StateListener = (state: ClientGameState) => void;
export type RejectionListener = (rejection: HopRejection) => void;
export type LeaveListener = () => void;
export type DroppedListener = () => void;

/**
 * Falling Platforms client API on top of the framework-independent
 * multiplayer SDK. Scenes and UI never talk to the SDK directly.
 */
export class GameClient {
  private readonly client: MultiplayerClient<ClientGameState, FallingPlatformsCommand>;
  private readonly stateListeners = new Set<StateListener>();
  private readonly rejectionListeners = new Set<RejectionListener>();
  private readonly leaveListeners = new Set<LeaveListener>();
  private readonly droppedListeners = new Set<DroppedListener>();
  private readonly reconnectedListeners = new Set<DroppedListener>();
  private intentionalLeave = false;

  sessionId = "";
  reconnectionToken = "";

  constructor(serverUrl: string) {
    this.client = new MultiplayerClient<ClientGameState, FallingPlatformsCommand>({
      serverUrl,
      storageKey: "falling-platforms:connection",
    });
    this.client.onStateChange((state) => {
      for (const listener of this.stateListeners) {
        listener(state);
      }
    });
    this.client.onMessage<HopRejection>("hop-rejected", (rejection) => {
      for (const listener of this.rejectionListeners) {
        listener(rejection);
      }
    });
    this.client.onConnectionChange((status: ConnectionStatus) => {
      this.syncMembership();
      if (status === "reconnecting") {
        for (const listener of this.droppedListeners) {
          listener();
        }
      } else if (status === "connected") {
        for (const listener of this.reconnectedListeners) {
          listener();
        }
      } else if (status === "disconnected") {
        this.sessionId = "";
        this.reconnectionToken = "";
        for (const listener of this.leaveListeners) {
          listener();
        }
      }
    });
  }

  get isConnected(): boolean {
    return this.client.getConnectionStatus() === "connected";
  }

  getState(): ClientGameState | null {
    return this.client.getState();
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

  onDropped(listener: DroppedListener): () => void {
    this.droppedListeners.add(listener);
    return () => this.droppedListeners.delete(listener);
  }

  onReconnected(listener: DroppedListener): () => void {
    this.reconnectedListeners.add(listener);
    return () => this.reconnectedListeners.delete(listener);
  }

  async createRoom(name: string): Promise<void> {
    this.intentionalLeave = false;
    await this.client.createRoom({ gameId: "falling_platforms", name });
  }

  async joinRoom(name: string, code: string): Promise<void> {
    this.intentionalLeave = false;
    await this.client.joinRoom({ roomCode: code, name });
  }

  async reconnect(token: string): Promise<void> {
    this.intentionalLeave = false;
    await this.client.reconnect(token);
  }

  sendHop(request: HopRequest): void {
    const command: FallingPlatformsCommand = {
      type: "hop",
      sequence: request.sequence,
      targetPlatformId: request.targetPlatformId,
    };
    this.client.sendGameCommand(command);
  }

  startMatch(): void {
    void this.client.startGame().catch(() => {
      // Expected failures surface through the connection/error events; the
      // lobby UI does not need per-request error handling.
    });
  }

  async leave(): Promise<number> {
    this.intentionalLeave = true;
    await this.client.leave();
    return 0;
  }

  private syncMembership(): void {
    const membership = this.client.getMembership();
    this.sessionId = membership?.sessionId ?? "";
    this.reconnectionToken = this.client.getReconnectionToken() ?? "";
  }
}
