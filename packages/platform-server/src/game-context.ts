import type { ConnectionStatus, MatchResult } from "@falling-platforms/platform-shared";

export interface GamePlayerRef {
  sessionId: string;
  name: string;
  connectionStatus: ConnectionStatus;
  isHost: boolean;
  isReady: boolean;
  joinedAt: number;
  joinedOrder: number;
}

/**
 * Controlled capabilities exposed to games. Games never touch Socket.IO,
 * Colyseus rooms or the platform internals.
 */
export interface GameContext {
  readonly roomId: string;
  readonly roomCode: string;
  readonly gameId: string;

  now(): number;

  getPlayers(): readonly GamePlayerRef[];
  getPlayer(sessionId: string): GamePlayerRef | undefined;

  emitToPlayer(sessionId: string, type: string, payload: unknown): void;
  emitToRoom(type: string, payload: unknown): void;

  scheduleIn(scheduleId: string, delayMs: number, callback: () => void): void;
  scheduleAt(scheduleId: string, runAt: number, callback: () => void): void;
  cancelSchedule(scheduleId: string): void;

  finishMatch(result: MatchResult): void;
  returnToLobby(): void;
}
