import type { KartRacingPhase, KartRacingTrack, TrackPoint } from "@phone-party/protocol";

import type { KartRacingServerConstants } from "./constants.js";

export interface KartRacingSettings {
  config: KartRacingServerConstants;
  e2eMode: boolean;
  countdownMs: number;
  resultsMs: number;
  raceFinishTimeoutMs: number;
  maxSpeed: number;
  acceleration: number;
  steeringStrength: number;
  projectileSpeed: number;
}

export interface RuntimeProjectile {
  id: string;
  ownerSessionId: string;
  x: number;
  y: number;
  heading: number;
  remainingMs: number;
}

/** Server-only authoritative player state. Never encoded into the schema. */
export interface RuntimePlayer {
  sessionId: string;
  playerId: string;
  name: string;
  connected: boolean;
  joinedOrder: number;
  color: string;
  removed: boolean;

  // Match state.
  matchPoints: number;
  raceWins: number;
  secondPlaces: number;
  thirdPlaces: number;
  totalRaceTimeMs: number;

  // Current race state.
  raceActive: boolean;
  active: boolean;
  finished: boolean;
  timedOut: boolean;
  completedLaps: number;
  /** Index into the required checkpoint list; equal to the count means finish is next. */
  nextCheckpointIndex: number;
  finishPosition: number;
  finishTimeMs: number;
  racePoints: number;
  lastRacePosition: number;
  lastRaceTimedOut: boolean;
  /** Live position in the current race (1-based; 0 outside a race). */
  racePosition: number;

  // Kart kinematics.
  x: number;
  y: number;
  heading: number;
  speed: number;
  steering: number;
  targetSteering: number;

  ammoLoaded: boolean;
  collectedCrateIds: Set<string>;
  hitStopUntil: number;
  immunityUntil: number;
  respawnImmunityUntil: number;
  respawnUntil: number;
  respawnPoint: TrackPoint | null;
  respawnHeading: number;
  wrongWay: boolean;
  wrongWayTimerMs: number;
  stuckMs: number;
  lastStuckX: number;
  lastStuckY: number;

  // Input protection.
  lastSteerSequence: number;
  seenSteerSequences: Set<number>;
  lastShootSequence: number;
  seenShootSequences: Set<number>;

  // Previous simulation position, used for checkpoint crossing detection.
  prevX: number;
  prevY: number;
}

export interface RaceResultEntry {
  sessionId: string;
  label: string;
  position: number;
  points: number;
  finishTimeMs: number;
  timedOut: boolean;
}

export interface MatchLeaderboardEntry {
  sessionId: string;
  label: string;
  rank: number;
  matchPoints: number;
  raceWins: number;
  totalRaceTimeMs: number;
}

export interface KartRacingMatchResult {
  winnerSessionIds: string[];
  leaderboard: MatchLeaderboardEntry[];
}

/**
 * Authoritative, server-only Kart Racing runtime. Hidden fields (seed, RNG,
 * pending input, sequence windows, rate-limit state, respawn points,
 * accumulators, and deadlines) live here and are projected to the
 * synchronized schema by sync.ts.
 */
export interface KartRacingRuntime {
  phase: KartRacingPhase;
  totalRaces: number;
  raceNumber: number;
  track: KartRacingTrack;
  countdownEndsAt: number;
  raceStartedAt: number;
  raceFinishTimeoutEndsAt: number;
  resultsEndsAt: number;
  raceSeed: string;
  activeCrates: Array<{ id: string; x: number; y: number }>;
  raceFinishOrder: string[];
  raceResult: RaceResultEntry[] | null;
  result: KartRacingMatchResult | null;
  simAccumMs: number;
  lastTickAt: number;
  players: Map<string, RuntimePlayer>;
  projectiles: RuntimeProjectile[];
  settings: KartRacingSettings;
  nextProjectileId: number;
  startingGrid: string[];
}
