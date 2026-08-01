import type { DifficultyStep } from "./constants.js";
import type { MatchPhase, PlatformStateValue } from "./types.js";

export type RuntimePlayer = {
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
};

export type RuntimePlatform = {
  id: string;
  gridX: number;
  gridY: number;
  state: PlatformStateValue;
  /** Absolute time (ms) when a warning platform becomes gone. 0 while stable. */
  goneAt: number;
};

export type MatchSettings = {
  allowSolo: boolean;
  e2eMode: boolean;
  countdownMs: number;
  initialSafePeriodMs: number;
  platformWarningMs: number;
  resultsDisplayMs: number;
  hopDurationMs: number;
  schedule: DifficultyStep[];
};

export type MatchRuntime = {
  phase: MatchPhase;
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
  resultsNotified: boolean;
  seed: string;
  rng: () => number;
  players: Map<string, RuntimePlayer>;
  platforms: Map<string, RuntimePlatform>;
  settings: MatchSettings;
};
