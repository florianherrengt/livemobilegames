import type {
  DifficultyStep,
  FallingPlatformsPhase,
  PlatformStateValue,
} from "@phone-party/protocol";

export interface RuntimePlayer {
  sessionId: string;
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
}

export interface RuntimePlatform {
  id: string;
  gridX: number;
  gridY: number;
  state: PlatformStateValue;
  /** Absolute time (ms) when a warning platform becomes gone. 0 while stable. */
  goneAt: number;
}

export interface MatchSettings {
  e2eMode: boolean;
  countdownMs: number;
  initialSafePeriodMs: number;
  platformWarningMs: number;
  resultsDisplayMs: number;
  hopDurationMs: number;
  schedule: readonly DifficultyStep[];
}

/**
 * Authoritative, server-only Falling Platforms runtime. Hidden fields (seed,
 * RNG, gone deadlines, countdown/results deadlines, next warning time and the
 * first-removal flag) live here and are projected to the synchronized schema
 * by sync.ts.
 */
export interface MatchRuntime {
  phase: FallingPlatformsPhase;
  winnerSessionId: string;
  draw: boolean;
  roundNumber: number;
  aliveCount: number;
  arenaSide: number;
  matchStartedAt: number;
  countdownEndsAt: number;
  resultsEndsAt: number;
  nextWarningAt: number;
  firstRemovalCycleDone: boolean;
  seed: string;
  rng: () => number;
  players: Map<string, RuntimePlayer>;
  platforms: Map<string, RuntimePlatform>;
  settings: MatchSettings;
}
