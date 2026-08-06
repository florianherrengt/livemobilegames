import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

export const FLAPPY_RACE_GAME_ID = "flappy-race";

// --- Phases ---

export const flappyRacePhaseSchema = z.enum([
  "lobby",
  "countdown",
  "running",
  "round-result",
  "finished",
]);

export type FlappyRacePhase = z.infer<typeof flappyRacePhaseSchema>;

// --- Client commands ---

/**
 * The only Flappy Race game command: flap. The payload is pure intent: a
 * client-chosen sequence for ordering and the round the player believes is
 * active. The server derives the actor from the connected client and validates
 * phase, membership, round, sequence, and rate against authoritative state.
 *
 * The payload is strict so unknown fields cannot smuggle positions,
 * velocities, collisions, scores, identity, or outcomes into the room
 * boundary.
 */
export const flapCommandSchema = z
  .object({
    type: z.literal("flap"),
    sequence: z.number().int().finite(),
    roundNumber: z.number().int().min(1),
  })
  .strict();

export type FlapCommand = z.infer<typeof flapCommandSchema>;

export const flappyRaceCommandSchema = z.discriminatedUnion("type", [flapCommandSchema]);

export type FlappyRaceCommand = z.infer<typeof flappyRaceCommandSchema>;

export const flapRejectionReasonSchema = z.enum([
  "not-running",
  "not-active",
  "old-round",
  "stale-sequence",
  "rate-limited",
]);

export type FlapRejectionReason = z.infer<typeof flapRejectionReasonSchema>;

/** Private flap rejection sent only to the player whose flap was refused. */
export const flapRejectionSchema = z
  .object({
    sequence: z.number().int().finite(),
    roundNumber: z.number().int().min(1),
    reason: flapRejectionReasonSchema,
  })
  .strict();

export type FlapRejection = z.infer<typeof flapRejectionSchema>;

export const FLAPPY_RACE_MESSAGE_TYPES = {
  flap: "game:flap",
  flapRejected: "flap-rejected",
} as const;

// --- Shared geometry ---

/**
 * Shared Flappy Race geometry. The server uses these values for simulation and
 * collision; the web renderer uses the same values so drawn pillars and birds
 * match the authoritative course. Server-only tuning (gravity, impulse,
 * timings, E2E overrides) lives in the server game constants module.
 */
export const FLAPPY_RACE_CONSTANTS = {
  WORLD_WIDTH: 390,
  WORLD_HEIGHT: 844,
  BIRD_X: 70,
  BIRD_WIDTH: 34,
  BIRD_HEIGHT: 30,
  BIRD_START_Y: 380,
  OBSTACLE_WIDTH: 74,
  GAP_SIZE: 210,
  OBSTACLE_SPACING: 230,
  COURSE_SPEED: 170,
  SAFE_START_DISTANCE: 180,
  UPPER_MARGIN: 70,
  LOWER_MARGIN: 50,
  MAX_OBSTACLES: 120,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
} as const;

export type FlappyRaceConstants = typeof FLAPPY_RACE_CONSTANTS;

/** Left edge x of an obstacle at the given course elapsed time. */
export function obstacleLeftX(
  config: Pick<FlappyRaceConstants, "WORLD_WIDTH" | "SAFE_START_DISTANCE" | "OBSTACLE_SPACING">,
  obstacleIndex: number,
  courseSpeed: number,
  elapsedMs: number,
): number {
  const base =
    config.WORLD_WIDTH + config.SAFE_START_DISTANCE + obstacleIndex * config.OBSTACLE_SPACING;
  return base - (courseSpeed * elapsedMs) / 1000;
}

export function obstacleRightX(
  config: Pick<
    FlappyRaceConstants,
    "WORLD_WIDTH" | "SAFE_START_DISTANCE" | "OBSTACLE_SPACING" | "OBSTACLE_WIDTH"
  >,
  obstacleIndex: number,
  courseSpeed: number,
  elapsedMs: number,
): number {
  return obstacleLeftX(config, obstacleIndex, courseSpeed, elapsedMs) + config.OBSTACLE_WIDTH;
}

/**
 * True once the whole bird has moved beyond the obstacle's trailing (right)
 * edge. Progress is awarded exactly once by callers that advance a monotonic
 * next-obstacle index.
 */
export function hasPassedObstacle(
  config: Pick<
    FlappyRaceConstants,
    "WORLD_WIDTH" | "SAFE_START_DISTANCE" | "OBSTACLE_SPACING" | "OBSTACLE_WIDTH" | "BIRD_X"
  >,
  obstacleIndex: number,
  courseSpeed: number,
  elapsedMs: number,
): boolean {
  return obstacleRightX(config, obstacleIndex, courseSpeed, elapsedMs) < config.BIRD_X;
}

// --- Synchronized Colyseus state ---

export class FlappyRacePlayerState extends Schema {
  @type("string") name = "";
  @type("string") connectionStatus: "connected" | "reconnecting" | "disconnected" = "connected";
  @type("number") joinedOrder = 0;
  @type("string") color = "";
  @type("number") roundWins = 0;
  @type("number") clearedObstacleCount = 0;
  @type("boolean") roundActive = false;
  @type("boolean") eliminated = false;
  /** Dropped mid-match: spectates the rest of the match. */
  @type("boolean") matchRemoved = false;
  @type("number") birdY = 0;
  @type("number") birdVy = 0;
}

export class FlappyRaceLeaderboardEntryState extends Schema {
  @type("string") sessionId = "";
  @type("number") rank = 0;
  @type("number") primaryScore = 0;
  @type("string") label = "";
}

/** Final match result, synchronized while the room is finished. */
export class FlappyRaceResultState extends Schema {
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([FlappyRaceLeaderboardEntryState]) leaderboard =
    new ArraySchema<FlappyRaceLeaderboardEntryState>();
}

/**
 * Synchronized Flappy Race room state.
 *
 * Only public round facts are exposed: phase, round number, deadlines, course
 * geometry, per-player kinematics and scores. The seed, RNG, pending flap
 * queue, sequence windows, rate-limit state, and all other server-only
 * simulation internals stay outside the schema.
 */
export class FlappyRaceState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: FlappyRacePhase = "lobby";
  @type("number") roundNumber = 0;
  @type("number") totalRounds = 0;
  /** Absolute epoch ms when the countdown ends; 0 outside countdown. */
  @type("number") countdownEndsAt = 0;
  /** Authoritative course elapsed ms since the round began moving. */
  @type("number") courseElapsedMs = 0;
  /** Absolute epoch ms when the round-result screen advances. */
  @type("number") resultsEndsAt = 0;
  /** Authoritative course speed (px/s) for the current match. */
  @type("number") courseSpeed = 0;
  @type(["number"]) obstacleOpenings = new ArraySchema<number>();
  @type(["string"]) roundWinnerSessionIds = new ArraySchema<string>();
  @type({ map: FlappyRacePlayerState }) players = new MapSchema<FlappyRacePlayerState>();
  @type(FlappyRaceResultState) result: FlappyRaceResultState | null = null;
}
