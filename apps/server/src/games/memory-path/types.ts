import type { MemoryPathDifficulty, MemoryPathPhase } from "@phone-party/protocol";

import type { Point2D } from "./geometry.js";
import type { MemoryPathLandmark, PathTemplate } from "./paths.js";

export interface MemoryPathSettings {
  e2eMode: boolean;
  preparingMs: number;
  previewMs: number;
  raceMs: number;
  flashIntervalMs: number;
  flashDurationMs: number;
  roundResultMs: number;
  movementSpeed: number;
}

/** Server-only authoritative player state. Never encoded into the schema. */
export interface RuntimePlayer {
  sessionId: string;
  name: string;
  connected: boolean;
  /** Part of the current round; false for sudden-death spectators. */
  participating: boolean;
  /** Moving/falling participant in the current round. */
  roundActive: boolean;
  finished: boolean;
  falling: boolean;
  respawnEndsAt: number;
  position: Point2D;
  inputX: number;
  inputY: number;
  /** Current valid progress along the route; reset on a fall. */
  progress: number;
  /** Best valid progress reached this round; preserved across falls. */
  maxProgress: number;
  /** Absolute epoch ms when maxProgress was first reached. */
  maxProgressFirstReachedAt: number;
  falls: number;
  roundWins: number;
  color: string;
  joinedOrder: number;
  lastAcceptedSequence: number;
  seenMoveSequences: Set<number>;
}

export interface RoundResultData {
  roundNumber: number;
  winnerSessionIds: string[];
  winnerLabel: string;
  reason: "finish" | "timeout";
  winnerProgress: number;
  suddenDeath: boolean;
}

export interface MatchResultEntry {
  sessionId: string;
  rank: number;
  roundWins: number;
  label: string;
}

export interface MatchResultData {
  winnerSessionIds: string[];
  leaderboard: MatchResultEntry[];
  roundResults: RoundResultData[];
  suddenDeathUsed: boolean;
}

/**
 * Authoritative, server-only Memory Path runtime. Hidden fields (seed, RNG,
 * route pool, input sequences, deadlines, and simulation accumulators) live
 * here and are projected to the synchronized schema by sync.ts.
 */
export interface MemoryPathRuntime {
  phase: MemoryPathPhase;
  totalRounds: number;
  roundNumber: number;
  suddenDeath: boolean;
  preparingEndsAt: number;
  previewEndsAt: number;
  raceEndsAt: number;
  resultsEndsAt: number;
  raceStartedAt: number;
  raceElapsedMs: number;
  pathVisible: boolean;
  opponentsVisible: boolean;
  pathWidth: number;
  route: PathTemplate;
  landmarks: readonly MemoryPathLandmark[];
  usedRouteIds: Set<string>;
  seed: string;
  rng: () => number;
  players: Map<string, RuntimePlayer>;
  settings: MemoryPathSettings;
  roundResult: RoundResultData | null;
  /** Completed round results in match order, used for the final scoreboard. */
  roundResults: RoundResultData[];
  result: MatchResultData | null;
  lastTickAt: number;
}

export type { MemoryPathDifficulty, MemoryPathPhase };
