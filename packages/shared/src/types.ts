export type PlatformStateValue = "stable" | "warning" | "gone";

export type MatchPhase = "lobby" | "countdown" | "playing" | "results";

export type HopRejectionReason =
  | "not-playing"
  | "not-alive"
  | "already-jumping"
  | "invalid-target"
  | "target-gone"
  | "not-adjacent"
  | "stale-sequence"
  | "rate-limited"
  | "target-occupied";

export type HopRequest = {
  sequence: number;
  targetPlatformId: string;
};

export type HopRejection = {
  sequence: number;
  reason: HopRejectionReason;
};

/** Read-only view of a player for client rendering. */
export type ClientPlayerState = {
  name: string;
  connected: boolean;
  participating: boolean;
  alive: boolean;
  jumping: boolean;
  currentPlatformId: string;
  fromPlatformId: string;
  targetPlatformId: string;
  jumpStartedAt: number;
  jumpEndsAt: number;
  lastAcceptedSequence: number;
  joinedOrder: number;
};

export type ClientPlatformState = {
  id: string;
  gridX: number;
  gridY: number;
  state: PlatformStateValue;
};

/** Structural view of the synchronised room state used by the client. */
export type ClientGameState = {
  phase: MatchPhase;
  hostSessionId: string;
  roomCode: string;
  winnerSessionId: string;
  draw: boolean;
  roundNumber: number;
  aliveCount: number;
  arenaSide: number;
  matchStartedAt: number;
  players: Map<string, ClientPlayerState>;
  platforms: Map<string, ClientPlatformState>;
};
