import { type ConnectionStatus, MultiplayerClient } from "@falling-platforms/client-sdk";
import type {
  FlappyRaceClientState,
  FlappyRaceCommand,
  FlapRejection,
} from "@falling-platforms/flappy-race";

export type StateListener = (state: FlappyRaceClientState) => void;
export type LeaveListener = () => void;
export type DroppedListener = () => void;

/**
 * Flappy Race client API on top of the framework-independent multiplayer SDK.
 * Scenes and UI never talk to the SDK directly.
 */
export class GameClient {
  private readonly client: MultiplayerClient<FlappyRaceClientState, FlappyRaceCommand>;
  private readonly stateListeners = new Set<StateListener>();
  private readonly rejectionListeners = new Set<(rejection: FlapRejection) => void>();
  private readonly leaveListeners = new Set<LeaveListener>();
  private readonly droppedListeners = new Set<DroppedListener>();
  private readonly reconnectedListeners = new Set<DroppedListener>();
  private intentionalLeave = false;

  sessionId = "";
  reconnectionToken = "";

  constructor(serverUrl: string) {
    this.client = new MultiplayerClient<FlappyRaceClientState, FlappyRaceCommand>({
      serverUrl,
      storageKey: "flappy-race:connection",
    });
    this.client.onStateChange((state) => {
      for (const listener of this.stateListeners) {
        listener(state);
      }
    });
    this.client.onMessage<FlapRejection>("flap-rejected", (rejection) => {
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

  getState(): FlappyRaceClientState | null {
    return this.client.getState();
  }

  getEstimatedServerTime(): number | null {
    return this.client.getEstimatedServerTime();
  }

  get didLeaveIntentionally(): boolean {
    return this.intentionalLeave;
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onFlapRejected(listener: (rejection: FlapRejection) => void): () => void {
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
    await this.client.createRoom({ gameId: "flappy_race", name });
  }

  async joinRoom(name: string, code: string): Promise<void> {
    this.intentionalLeave = false;
    await this.client.joinRoom({ roomCode: code, name });
  }

  async reconnect(token: string): Promise<void> {
    this.intentionalLeave = false;
    await this.client.reconnect(token);
  }

  sendFlap(sequence: number, roundNumber: number): void {
    const command: FlappyRaceCommand = {
      type: "flap",
      sequence,
      roundNumber,
    };
    this.client.sendGameCommand(command);
  }

  startMatch(): void {
    void this.client.startGame().catch(() => {
      // Expected failures surface through the connection/error events; the
      // lobby UI does not need per-request error handling.
    });
  }

  playAgain(): void {
    void this.client.playAgain().catch(() => {
      // Expected failures surface through the error listener.
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
