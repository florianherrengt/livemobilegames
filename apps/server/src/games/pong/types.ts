import type { PongPhase, PongWorldEdge } from "@phone-party/protocol";

import type { PongServerConstants } from "./constants.js";

export interface PongSettings {
  config: PongServerConstants;
  e2eMode: boolean;
  countdownMs: number;
  spawnWarningMs: number;
  escalationIntervalMs: number;
  ballSpeed: number;
  paddleCrossTimeSeconds: number;
  spawnRadius: number;
}

/** One personal goal opening plus its paddle's legal movement range. */
export interface PongSlot {
  worldEdge: PongWorldEdge;
  slotIndex: number;
  openingStart: number;
  openingEnd: number;
  paddleLength: number;
  paddleMin: number;
  paddleMax: number;
}

/** Server-only authoritative player state. Never encoded into the schema. */
export interface RuntimePlayer {
  sessionId: string;
  name: string;
  connected: boolean;
  joinedOrder: number;
  color: string;
  worldEdge: PongWorldEdge;
  slotIndex: number;
  openingStart: number;
  openingEnd: number;
  paddleMin: number;
  paddleMax: number;
  paddleLength: number;
  paddleCenter: number;
  /** Proportional target (0..1) while the player holds the control; null = stop. */
  queuedTarget: number | null;
  lastAcceptedSequence: number;
  seenSequences: Set<number>;
  score: number;
}

export interface RuntimeBall {
  id: string;
  x: number;
  y: number;
  /** Unit direction while warning; full velocity once moving. */
  vx: number;
  vy: number;
  ownerSessionId: string;
  state: "warning" | "moving";
  /** Absolute epoch ms when a warning ball launches; 0 while moving. */
  spawnsAt: number;
}

export interface PongLeaderboardEntry {
  sessionId: string;
  rank: number;
  score: number;
  label: string;
}

export interface PongMatchResult {
  winnerSessionIds: string[];
  leaderboard: PongLeaderboardEntry[];
}

/**
 * Authoritative, server-only Pong runtime. Hidden fields (seed, RNG, pending
 * input targets, sequence windows, rate-limit state, simulation accumulators,
 * and deadlines) live here and are projected to the synchronized schema by
 * sync.ts.
 */
export interface PongRuntime {
  phase: PongPhase;
  countdownEndsAt: number;
  matchStartedAt: number;
  matchElapsedMs: number;
  ballSpeed: number;
  paddleSpeed: number;
  desiredBallCount: number;
  /** Player-count ball cap fixed when the match starts (leave-proof). */
  maxBallCount: number;
  lastGoalDefenderSessionId: string;
  lastGoalScorerSessionId: string;
  lastGoalAt: number;
  nextBallId: number;
  seed: string;
  rng: () => number;
  lastTickAt: number;
  simAccumMs: number;
  players: Map<string, RuntimePlayer>;
  balls: Map<string, RuntimeBall>;
  settings: PongSettings;
  result: PongMatchResult | null;
}
