import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

import type { GolfHazard } from "./golf-course.js";

export const GOLF_GAME_ID = "golf";

// --- Phases ---

export const golfRacePhaseSchema = z.enum([
  "lobby",
  "countdown",
  "aiming",
  "simulating",
  "round-result",
  "finished",
]);

export type GolfRacePhase = z.infer<typeof golfRacePhaseSchema>;

// --- Aiming / shot command ---

/**
 * Maximum drag distance the client can send, and the drag distance that maps
 * to maximum shot power. The server clamps and derives power from this same
 * contract value, so a client cannot smuggle a stronger shot.
 */
export const GOLF_MAX_DRAG_PX = 220;

/** A match always has exactly five rounds. */
export const GOLF_TOTAL_ROUNDS = 5;

/**
 * Each round after the first expands every hazard by this many pixels (rects
 * grow on every side, circles grow their radius), making later rounds
 * progressively harder. Shared by the server simulation and the web renderer
 * so both draw and resolve the same course.
 */
export const GOLF_HAZARD_GROWTH_PER_ROUND = 10;

/** Deterministic hazard expansion for a round (round 1 has no growth). */
export function golfHazardGrowthForRound(roundNumber: number): number {
  return Math.max(0, roundNumber - 1) * GOLF_HAZARD_GROWTH_PER_ROUND;
}

/** Returns a copy of a hazard expanded by `growthPx` on every side. */
export function expandGolfHazard(hazard: GolfHazard, growthPx: number): GolfHazard {
  if (hazard.kind === "rect") {
    return {
      kind: "rect",
      x: hazard.x - growthPx,
      y: hazard.y - growthPx,
      width: hazard.width + growthPx * 2,
      height: hazard.height + growthPx * 2,
    };
  }
  return {
    kind: "circle",
    x: hazard.x,
    y: hazard.y,
    radius: hazard.radius + growthPx,
  };
}

/**
 * The only Golf command: release a shot. The payload is pure intent: a client
 * sequence for stale/duplicate detection, the round the player believes is
 * active, and the pull-back drag vector in CSS pixels. The server derives the
 * actor from the connected client and validates phase, membership, round,
 * stationarity, power, and timing against authoritative state.
 *
 * `aimX`/`aimY` are the drag direction (pull-back), so the shot travels in
 * the opposite direction. The payload is strict so unknown fields cannot
 * smuggle positions, velocities, collisions, scores, identity, or outcomes
 * into the room boundary.
 */
export const golfShotSchema = z
  .object({
    type: z.literal("shot"),
    sequence: z.number().int().finite(),
    roundNumber: z.number().int().min(1),
    aimX: z.number().finite().min(-GOLF_MAX_DRAG_PX).max(GOLF_MAX_DRAG_PX),
    aimY: z.number().finite().min(-GOLF_MAX_DRAG_PX).max(GOLF_MAX_DRAG_PX),
  })
  .strict();

export type GolfShot = z.infer<typeof golfShotSchema>;

export const golfRaceCommandSchema = z.discriminatedUnion("type", [golfShotSchema]);

export type GolfRaceCommand = z.infer<typeof golfRaceCommandSchema>;

export const golfShotRejectionReasonSchema = z.enum([
  "not-aiming",
  "not-your-turn",
  "already-shot",
  "old-round",
  "stale-sequence",
  "ball-moving",
  "finished",
  "below-minimum-power",
  "timer-expired",
]);

export type GolfShotRejectionReason = z.infer<typeof golfShotRejectionReasonSchema>;

/** Private shot rejection sent only to the player whose shot was refused. */
export const golfShotRejectionSchema = z
  .object({
    sequence: z.number().int().finite(),
    roundNumber: z.number().int().min(1),
    reason: golfShotRejectionReasonSchema,
  })
  .strict();

export type GolfShotRejection = z.infer<typeof golfShotRejectionSchema>;

export const GOLF_MESSAGE_TYPES = {
  shot: "game:shot",
  shotRejected: "shot-rejected",
} as const;

// --- Synchronized Colyseus state ---

export class GolfRacePlayerState extends Schema {
  @type("string") name = "";
  @type("number") joinedOrder = 0;
  @type("string") color = "";
  @type("string") connectionStatus: "connected" | "reconnecting" | "disconnected" = "connected";
  @type("number") positionX = 0;
  @type("number") positionY = 0;
  @type("number") velocityX = 0;
  @type("number") velocityY = 0;
  @type("boolean") moving = false;
  @type("number") latestGateIndex = -1;
  @type("number") raceProgress = 0;
  @type("number") sectionProgress = 0;
  @type("boolean") finished = false;
  @type("number") finishedRank = 0;
  /** The round deadline ranked this unfinished ball by authoritative progress. */
  @type("boolean") timedOut = false;
  @type("boolean") playedThisRound = false;
  @type("number") roundWins = 0;
  @type("number") matchPoints = 0;
  @type("boolean") collisionImmune = false;
  /** Absolute epoch ms while immunity is active; 0 otherwise. */
  @type("number") immunityUntil = 0;
}

export class GolfRaceLeaderboardEntryState extends Schema {
  @type("string") sessionId = "";
  @type("number") rank = 0;
  @type("number") finishOrder = 0;
  @type("number") primaryScore = 0;
  @type("number") roundWins = 0;
  @type("string") label = "";
}

/** Final race result, synchronized while the room is finished. */
export class GolfRaceResultState extends Schema {
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([GolfRaceLeaderboardEntryState]) leaderboard =
    new ArraySchema<GolfRaceLeaderboardEntryState>();
}

/**
 * Synchronized Golf room state.
 *
 * Only public race facts are exposed: phase, round, whose turn it is, aiming
 * deadlines, turn order, per-player kinematics and progress, and the final
 * result. The authoritative engine, course validation, physics accumulators,
 * shot sequence windows, and all server-only internals stay outside the
 * schema.
 */
export class GolfRaceState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: GolfRacePhase = "lobby";
  @type("number") roundNumber = 0;
  @type("number") totalRounds = 0;
  /** Absolute epoch ms when the opening countdown ends; 0 outside countdown. */
  @type("number") countdownEndsAt = 0;
  /** Absolute epoch ms when the round-result screen advances; 0 otherwise. */
  @type("number") resultsEndsAt = 0;
  /** Absolute epoch ms when the current aiming turn ends; 0 otherwise. */
  @type("number") aimingEndsAt = 0;
  /** Absolute epoch ms when the current round is ranked by progress. */
  @type("number") roundEndsAt = 0;
  /** Session id of the player currently aiming; "" when nobody is aiming. */
  @type("string") currentTurnSessionId = "";
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type("number") turnIndex = 0;
  @type("number") finishedCount = 0;
  @type(["string"]) roundWinnerSessionIds = new ArraySchema<string>();
  @type({ map: GolfRacePlayerState }) players = new MapSchema<GolfRacePlayerState>();
  @type(GolfRaceResultState) result: GolfRaceResultState | null = null;
}
