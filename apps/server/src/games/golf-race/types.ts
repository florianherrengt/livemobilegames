import type { GolfCourse, GolfRacePhase } from "@phone-party/protocol";

import type { GolfServerConstants } from "./constants.js";

export interface GolfSettings {
  config: GolfServerConstants;
  e2eMode: boolean;
  aimMs: number;
  countdownMs: number;
  immunityMs: number;
  roundResultMs: number;
  maxShotSpeed: number;
}

/** Server-only authoritative player state. Never encoded into the schema. */
export interface RuntimePlayer {
  sessionId: string;
  name: string;
  connected: boolean;
  /** True after a permanent leave; kept only for finished players' results. */
  removed: boolean;
  color: string;
  joinedOrder: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  stoppedSince: number | null;
  latestGateIndex: number;
  raceProgress: number;
  sectionProgress: number;
  finished: boolean;
  finishedRank: number;
  roundWins: number;
  matchPoints: number;
  /** True once this player's turn in the current round has been consumed. */
  playedThisRound: boolean;
  shotTakenThisTurn: boolean;
  collisionImmunityUntil: number;
  protectedNextTurn: boolean;
  lastShotSequence: number;
  seenShotSequences: Set<number>;
}

export interface GolfLeaderboardEntry {
  sessionId: string;
  rank: number;
  finishOrder: number;
  primaryScore: number;
  roundWins: number;
  label: string;
}

export interface GolfResult {
  winnerSessionIds: string[];
  leaderboard: GolfLeaderboardEntry[];
}

/**
 * Authoritative, server-only Golf runtime. Hidden fields (course route
 * distances, physics accumulators, shot sequence windows, immunity deadlines
 * and turn bookkeeping) live here and are projected to the synchronized
 * schema by sync.ts.
 */
export interface GolfRuntime {
  phase: GolfRacePhase;
  course: GolfCourse;
  /** Course copy with hazards expanded for the current round. */
  roundCourse: GolfCourse;
  routeDistances: number[];
  settings: GolfSettings;
  roundNumber: number;
  totalRounds: number;
  roundWinnerSessionIds: string[];
  resultsEndsAt: number;
  roundParticipantCount: number;
  turnOrder: string[];
  turnIndex: number;
  currentTurnSessionId: string;
  aimingEndsAt: number;
  countdownEndsAt: number;
  lastTickAt: number;
  simAccumMs: number;
  finishOrder: number;
  players: Map<string, RuntimePlayer>;
  result: GolfResult | null;
}
