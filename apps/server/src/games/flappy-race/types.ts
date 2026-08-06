import type { FlappyRacePhase } from "@phone-party/protocol";

import type { FlappyRaceServerConstants } from "./constants.js";

export type { FlappyRacePhase };

export interface FlappyRaceSettings {
  config: FlappyRaceServerConstants;
  e2eMode: boolean;
  countdownMs: number;
  roundResultMs: number;
  courseSpeed: number;
}

/** Server-only authoritative player state. Never encoded into the schema. */
export interface RuntimePlayer {
  sessionId: string;
  name: string;
  connected: boolean;
  /** Participant still in the match (never dropped mid-match). */
  eligible: boolean;
  /** Alive and simulating in the current round. */
  roundActive: boolean;
  /** Crashed in the current round (kept for UI/legend purposes). */
  eliminated: boolean;
  birdY: number;
  birdVy: number;
  clearedObstacleCount: number;
  /** Index of the next obstacle the bird still has to pass. */
  nextObstacleIndex: number;
  flapQueued: boolean;
  lastFlapSequence: number;
  seenFlapSequences: Set<number>;
  roundWins: number;
  roundWonThisRound: boolean;
  color: string;
  joinedOrder: number;
}

export interface RoundProgressCandidate {
  sessionId: string;
  clearedObstacleCount: number;
  roundActive: boolean;
  eligible: boolean;
}

export interface FlappyRaceLeaderboardEntry {
  sessionId: string;
  rank: number;
  primaryScore: number;
  label: string;
}

export interface FlappyRaceMatchResult {
  winnerSessionIds: string[];
  leaderboard: FlappyRaceLeaderboardEntry[];
}

/**
 * Authoritative, server-only Flappy Race runtime. Hidden fields (seed, RNG,
 * pending flap queues, sequence windows, rate-limit state, simulation
 * accumulators, and deadlines) live here and are projected to the
 * synchronized schema by sync.ts.
 */
export interface FlappyRaceRuntime {
  phase: FlappyRacePhase;
  totalRounds: number;
  roundNumber: number;
  countdownEndsAt: number;
  courseElapsedMs: number;
  resultsEndsAt: number;
  courseSeed: string;
  openings: number[];
  roundWinnerSessionIds: string[];
  roundEnded: boolean;
  simAccumMs: number;
  lastTickAt: number;
  players: Map<string, RuntimePlayer>;
  settings: FlappyRaceSettings;
  result: FlappyRaceMatchResult | null;
}
