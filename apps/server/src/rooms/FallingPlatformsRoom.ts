import {
  generateRoomCode,
  HOP_MESSAGES_PER_SECOND,
  RECONNECT_GRACE_MS,
} from "@falling-platforms/shared";
import { type Client, ErrorCode, Room, ServerError, validate } from "colyseus";
import { startHop, validateHop } from "../game/hopping.js";
import {
  addPlayer,
  createRuntime,
  handlePlayerLeave,
  startMatch,
  updateMatch,
} from "../game/match.js";
import { buildSettings } from "../game/settings.js";
import type { MatchRuntime, RuntimePlayer } from "../game/types.js";
import { GameState } from "../state/GameState.js";
import { copyPlatform, copyPlayer } from "../state/mirror.js";
import { PlatformState } from "../state/PlatformState.js";
import { PlayerState } from "../state/PlayerState.js";
import { hopRequestSchema, joinOptionsSchema, startMatchSchema } from "../validation/messages.js";

/**
 * In-memory registry of active room codes, keyed by roomId. Codes are unique
 * among live rooms and freed when the room is disposed. Horizontal scaling
 * would require moving this to shared presence/storage.
 */
const activeRoomCodes = new Set<string>();

function claimRoomCode(): string {
  for (;;) {
    const code = generateRoomCode();
    if (!activeRoomCodes.has(code)) {
      activeRoomCodes.add(code);
      return code;
    }
  }
}

export class FallingPlatformsRoom extends Room<{ state: GameState }> {
  state = new GameState();

  runtime!: MatchRuntime;

  /** No arbitrary gameplay cap; arena size grows with participants. */
  maxClients = Number.POSITIVE_INFINITY;

  private nextJoinedOrder = 0;
  private hopTimestamps = new Map<string, number[]>();
  private finalizedLeaves = new Set<string>();

  async onCreate(_options: unknown): Promise<void> {
    const roomCode = claimRoomCode();
    this.roomId = roomCode;
    this.runtime = createRuntime(roomCode, buildSettings());
    this.state.roomCode = roomCode;
    this.setSimulationInterval(() => this.onSimulationTick(), 50);
  }

  onJoin(client: Client, options: unknown): void {
    const parsed = joinOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid display name");
    }
    const player = addPlayer(
      this.runtime,
      client.sessionId,
      parsed.data.name,
      this.nextJoinedOrder++,
    );
    this.state.players.set(client.sessionId, playerToState(player));
    this.syncState();
  }

  async onDrop(client: Client): Promise<void> {
    const player = this.runtime.players.get(client.sessionId);
    if (!player) {
      return;
    }
    player.connected = false;
    this.syncPlayer(client.sessionId);
    try {
      // Resolves when the client reconnects (onReconnect then restores control).
      await this.allowReconnection(client, RECONNECT_GRACE_MS / 1000);
    } catch {
      // Grace period expired; onLeave finalises the removal.
    }
  }

  onReconnect(client: Client): void {
    const player = this.runtime.players.get(client.sessionId);
    if (player) {
      player.connected = true;
      this.syncPlayer(client.sessionId);
    }
  }

  onLeave(client: Client): void {
    if (this.finalizedLeaves.has(client.sessionId)) {
      return;
    }
    this.finalizedLeaves.add(client.sessionId);
    handlePlayerLeave(this.runtime, client.sessionId, this.clock.currentTime);
    this.syncState();
  }

  onDispose(): void {
    activeRoomCodes.delete(this.runtime?.roomCode ?? "");
  }

  messages = {
    hop: validate(hopRequestSchema, (client, message) => {
      this.onHopMessage(client, message.sequence, message.targetPlatformId);
    }),
    start: validate(startMatchSchema, (client) => {
      this.onStartMessage(client);
    }),
  };

  private onHopMessage(client: Client, sequence: number, targetPlatformId: string): void {
    const player = this.runtime.players.get(client.sessionId);
    if (!player) {
      return;
    }
    if (!this.consumeHopRateLimit(client.sessionId)) {
      client.send("hop-rejected", { sequence, reason: "rate-limited" });
      return;
    }

    const reason = validateHop(this.runtime, player, targetPlatformId, sequence);
    if (reason) {
      client.send("hop-rejected", { sequence, reason });
      return;
    }

    startHop(this.runtime, player, targetPlatformId, sequence, this.clock.currentTime);
    this.syncPlayer(client.sessionId);
  }

  private onStartMessage(client: Client): void {
    if (client.sessionId !== this.runtime.hostSessionId) {
      return;
    }
    if (this.runtime.phase !== "lobby") {
      return;
    }
    if (startMatch(this.runtime, this.clock.currentTime)) {
      this.syncState();
    }
  }

  private onSimulationTick(): void {
    updateMatch(this.runtime, this.clock.currentTime);
    this.syncState();
  }

  private consumeHopRateLimit(sessionId: string): boolean {
    const now = this.clock.currentTime;
    const recent = (this.hopTimestamps.get(sessionId) ?? []).filter(
      (timestamp) => timestamp >= now - 1000,
    );
    if (recent.length >= HOP_MESSAGES_PER_SECOND) {
      this.hopTimestamps.set(sessionId, recent);
      return false;
    }
    recent.push(now);
    this.hopTimestamps.set(sessionId, recent);
    return true;
  }

  private syncPlayer(sessionId: string): void {
    const player = this.runtime.players.get(sessionId);
    const schemaPlayer = this.state.players.get(sessionId);
    if (player && schemaPlayer) {
      copyPlayer(schemaPlayer, player);
    }
  }

  private syncState(): void {
    const state = this.state;
    const runtime = this.runtime;
    state.phase = runtime.phase;
    state.hostSessionId = runtime.hostSessionId;
    state.winnerSessionId = runtime.winnerSessionId;
    state.draw = runtime.draw;
    state.roundNumber = runtime.roundNumber;
    state.aliveCount = runtime.aliveCount;
    state.arenaSide = runtime.arenaSide;
    state.matchStartedAt = runtime.matchStartedAt;

    for (const [sessionId, player] of runtime.players) {
      let schemaPlayer = state.players.get(sessionId);
      if (!schemaPlayer) {
        schemaPlayer = new PlayerState();
        state.players.set(sessionId, schemaPlayer);
      }
      copyPlayer(schemaPlayer, player);
    }
    for (const key of [...state.players.keys()]) {
      if (!runtime.players.has(key)) {
        state.players.delete(key);
      }
    }

    for (const [id, platform] of runtime.platforms) {
      let schemaPlatform = state.platforms.get(id);
      if (!schemaPlatform) {
        schemaPlatform = new PlatformState();
        state.platforms.set(id, schemaPlatform);
      }
      copyPlatform(schemaPlatform, platform);
    }
    for (const key of [...state.platforms.keys()]) {
      if (!runtime.platforms.has(key)) {
        state.platforms.delete(key);
      }
    }
  }
}

function playerToState(player: RuntimePlayer): PlayerState {
  const state = new PlayerState();
  copyPlayer(state, player);
  return state;
}
