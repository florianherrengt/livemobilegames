import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

export const MEMORY_PATH_GAME_ID = "memory-path";

// --- Phases and round outcomes ---

export const memoryPathPhaseSchema = z.enum([
  "lobby",
  "preparing",
  "preview",
  "racing",
  "round-result",
  "match-result",
]);

export type MemoryPathPhase = z.infer<typeof memoryPathPhaseSchema>;

export const memoryPathDifficultySchema = z.enum(["easy", "medium", "hard"]);

export type MemoryPathDifficulty = z.infer<typeof memoryPathDifficultySchema>;

export const memoryPathRoundResultReasonSchema = z.enum(["finish", "timeout"]);

export type MemoryPathRoundResultReason = z.infer<typeof memoryPathRoundResultReasonSchema>;

// --- Client commands ---

/**
 * The only Memory Path game command: a joystick movement intention. The
 * payload is pure intent: a client-chosen sequence, the round the player
 * believes is active, and a direction vector. The server derives the actor
 * from the connected client and validates phase, membership, round, sequence,
 * vector bounds, and rate against authoritative state.
 *
 * The payload is strict so unknown fields cannot smuggle positions, fall
 * results, progress, scores, or identity into the room boundary.
 */
export const memoryPathMoveSchema = z
  .object({
    type: z.literal("move"),
    sequence: z.number().int().finite(),
    roundNumber: z.number().int().min(1),
    x: z.number().finite().min(-1).max(1),
    y: z.number().finite().min(-1).max(1),
  })
  .strict();

export type MemoryPathMove = z.infer<typeof memoryPathMoveSchema>;

export const memoryPathCommandSchema = z.discriminatedUnion("type", [memoryPathMoveSchema]);

export type MemoryPathCommand = z.infer<typeof memoryPathCommandSchema>;

export const memoryPathMoveRejectionReasonSchema = z.enum([
  "not-moving",
  "not-active",
  "old-round",
  "stale-sequence",
  "rate-limited",
]);

export type MemoryPathMoveRejectionReason = z.infer<typeof memoryPathMoveRejectionReasonSchema>;

/** Private move rejection sent only to the player whose intent was refused. */
export const memoryPathMoveRejectionSchema = z
  .object({
    sequence: z.number().int().finite(),
    roundNumber: z.number().int().min(1),
    reason: memoryPathMoveRejectionReasonSchema,
  })
  .strict();

export type MemoryPathMoveRejection = z.infer<typeof memoryPathMoveRejectionSchema>;

export const MEMORY_PATH_MESSAGE_TYPES = {
  move: "game:move",
  moveRejected: "move-rejected",
} as const;

// --- Shared gameplay constants ---

/**
 * Shared Memory Path gameplay constants. The server uses these values for the
 * authoritative world, path geometry, timers, and movement; the web renderer
 * uses the same values so drawn maps and players match the authoritative
 * course. Server-only tuning (path-width tolerance, update cadence, input
 * rate, reconnect grace, and E2E timing overrides) lives in the server game
 * constants module.
 */
export const MEMORY_PATH_CONSTANTS = {
  WORLD_WIDTH: 390,
  WORLD_HEIGHT: 844,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  NORMAL_ROUNDS: 3,
  PREPARING_MS: 1_200,
  PREVIEW_MS: 5_000,
  RACE_MS: 30_000,
  FLASH_INTERVAL_MS: 5_000,
  FLASH_DURATION_MS: 750,
  RESPAWN_DELAY_MS: 750,
  ROUND_RESULT_MS: 4_000,
  MOVEMENT_SPEED: 130,
  PLAYER_DIAMETER: 18,
  EASY_PATH_WIDTH: 56,
  MEDIUM_PATH_WIDTH: 48,
  HARD_PATH_WIDTH: 42,
  FINISH_RADIUS: 30,
  START_RADIUS: 32,
  START_X: 195,
  START_Y: 700,
  FINISH_X: 195,
  FINISH_Y: 140,
  PLAY_AREA_LEFT: 24,
  PLAY_AREA_RIGHT: 366,
  PLAY_AREA_TOP: 90,
  PLAY_AREA_BOTTOM: 760,
} as const;

export type MemoryPathConstants = typeof MEMORY_PATH_CONSTANTS;

// --- Synchronized Colyseus state ---

export class MemoryPathPointState extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
}

export class MemoryPathLandmarkState extends Schema {
  @type("string") id = "";
  @type("string") shape: "circle" | "square" | "triangle" = "circle";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") size = 0;
  @type("string") color = "";
}

export class MemoryPathPlayerState extends Schema {
  @type("string") name = "";
  @type("string") connectionStatus: "connected" | "reconnecting" | "disconnected" = "connected";
  @type("number") joinedOrder = 0;
  @type("string") color = "";
  @type("number") roundWins = 0;
  /** Whether the player is part of the current round (false for sudden-death spectators). */
  @type("boolean") participating = false;
  @type("boolean") roundActive = false;
  @type("boolean") finished = false;
  @type("boolean") falling = false;
  /** Absolute epoch ms when a fall respawn completes; 0 while not falling. */
  @type("number") respawnEndsAt = 0;
  @type("number") positionX = 0;
  @type("number") positionY = 0;
  /** Current valid progress along the route, reset to the start on a fall. */
  @type("number") progress = 0;
  /** Best valid progress reached this round; preserved across falls. */
  @type("number") maxProgress = 0;
  @type("number") falls = 0;
}

export class MemoryPathLeaderboardEntryState extends Schema {
  @type("string") sessionId = "";
  @type("number") rank = 0;
  @type("number") roundWins = 0;
  @type("string") label = "";
}

export class MemoryPathRoundResultState extends Schema {
  @type("number") roundNumber = 0;
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  /** Stable display name captured when the round ended, even if the player later leaves. */
  @type("string") winnerLabel = "";
  @type("string") reason: MemoryPathRoundResultReason = "finish";
  /** Winner's valid progress percentage (0-100) for timeout results. */
  @type("number") winnerProgress = 0;
  @type("boolean") suddenDeath = false;
}

export class MemoryPathMatchResultState extends Schema {
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([MemoryPathLeaderboardEntryState]) leaderboard =
    new ArraySchema<MemoryPathLeaderboardEntryState>();
  @type([MemoryPathRoundResultState]) roundResults = new ArraySchema<MemoryPathRoundResultState>();
  @type("boolean") suddenDeathUsed = false;
}

/**
 * Synchronized Memory Path room state.
 *
 * Only public round facts are exposed: phase, deadlines, route geometry and
 * width, landmarks, flash visibility, per-player positions and progress, and
 * round/match results. The seed, RNG, route pool, input sequences, rate-limit
 * state, and all other server-only simulation internals stay outside the
 * schema. Route geometry is public because every client must render the same
 * map during previews and flashes; the renderer is responsible for hiding it
 * when `pathVisible` is false.
 */
export class MemoryPathState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: MemoryPathPhase = "lobby";
  @type("number") roundNumber = 0;
  @type("number") totalRounds = 0;
  @type("boolean") suddenDeath = false;
  /** Absolute epoch ms when the preparing phase ends; 0 outside preparing. */
  @type("number") preparingEndsAt = 0;
  /** Absolute epoch ms when the preview ends; 0 outside preview. */
  @type("number") previewEndsAt = 0;
  /** Absolute epoch ms when the race ends; 0 outside racing. */
  @type("number") raceEndsAt = 0;
  /** Absolute epoch ms when the round-result screen advances; 0 outside it. */
  @type("number") resultsEndsAt = 0;
  /** Authoritative elapsed race ms since movement became enabled. */
  @type("number") raceElapsedMs = 0;
  @type("boolean") pathVisible = false;
  @type("boolean") opponentsVisible = false;
  @type("number") pathWidth = 0;
  @type("number") movementSpeed = 0;
  @type("number") startX = MEMORY_PATH_CONSTANTS.START_X;
  @type("number") startY = MEMORY_PATH_CONSTANTS.START_Y;
  @type("number") finishX = MEMORY_PATH_CONSTANTS.FINISH_X;
  @type("number") finishY = MEMORY_PATH_CONSTANTS.FINISH_Y;
  @type("number") finishRadius = MEMORY_PATH_CONSTANTS.FINISH_RADIUS;
  @type("number") startRadius = MEMORY_PATH_CONSTANTS.START_RADIUS;
  @type([MemoryPathPointState]) routePoints = new ArraySchema<MemoryPathPointState>();
  @type([MemoryPathLandmarkState]) landmarks = new ArraySchema<MemoryPathLandmarkState>();
  @type({ map: MemoryPathPlayerState }) players = new MapSchema<MemoryPathPlayerState>();
  @type(MemoryPathRoundResultState) roundResult: MemoryPathRoundResultState | null = null;
  @type(MemoryPathMatchResultState) matchResult: MemoryPathMatchResultState | null = null;
}
