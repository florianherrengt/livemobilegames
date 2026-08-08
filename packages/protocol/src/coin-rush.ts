import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

export const COIN_RUSH_GAME_ID = "coin-rush";

// --- Phases and movement ---

export const coinRushPhaseSchema = z.enum([
  "lobby",
  "countdown",
  "playing",
  "round-result",
  "finished",
]);

export type CoinRushPhase = z.infer<typeof coinRushPhaseSchema>;

export const coinRushDirectionSchema = z.enum(["up", "down", "left", "right"]);

export type CoinRushDirection = z.infer<typeof coinRushDirectionSchema>;

export const coinRushTerrainSchema = z.enum(["safe", "road"]);

export type CoinRushTerrain = z.infer<typeof coinRushTerrainSchema>;

export const coinRushDeathTypeSchema = z.enum(["", "vehicle", "fall"]);

export type CoinRushDeathType = z.infer<typeof coinRushDeathTypeSchema>;

// --- Client commands ---

/**
 * The only Coin Rush game command: one swipe in a cardinal direction. The
 * payload is pure intent: a client-chosen sequence for ordering and the
 * direction the player wants to move. The server derives the actor from the
 * connected client and validates phase, membership, timing, movement
 * conflicts, pushes, collisions, and outcomes against authoritative state.
 *
 * The payload is strict so unknown fields cannot smuggle positions, pushes,
 * scores, identity, or outcomes into the room boundary.
 */
export const coinRushMoveSchema = z
  .object({
    type: z.literal("move"),
    sequence: z.number().int().finite().nonnegative(),
    direction: coinRushDirectionSchema,
  })
  .strict();

export type CoinRushMove = z.infer<typeof coinRushMoveSchema>;

export const coinRushCommandSchema = z.discriminatedUnion("type", [coinRushMoveSchema]);

export type CoinRushCommand = z.infer<typeof coinRushCommandSchema>;

export const coinRushMoveRejectionReasonSchema = z.enum([
  "not-playing",
  "not-alive",
  "not-eligible",
  "respawning",
  "already-moving",
  "out-of-bounds",
  "stale-sequence",
  "rate-limited",
]);

export type CoinRushMoveRejectionReason = z.infer<typeof coinRushMoveRejectionReasonSchema>;

/** Private move rejection sent only to the player whose swipe was refused. */
export const coinRushMoveRejectionSchema = z
  .object({
    sequence: z.number().int().finite().nonnegative(),
    reason: coinRushMoveRejectionReasonSchema,
  })
  .strict();

export type CoinRushMoveRejection = z.infer<typeof coinRushMoveRejectionSchema>;

export const COIN_RUSH_MESSAGE_TYPES = {
  move: "game:move",
  moveRejected: "move-rejected",
} as const;

// --- Shared gameplay constants ---

export const COIN_RUSH_CONSTANTS = {
  COL_COUNT: 9,
  ROW_COUNT: 17,
  SAFE_ROWS: 2,
  WIN_SCORE: 10,
  TOTAL_ROUNDS: 3,
  MOVE_DURATION_MS: 240,
  PUSH_DURATION_MS: 260,
  BOUNCE_DURATION_MS: 240,
  COIN_POP_MS: 300,
  DEATH_ANIMATION_MS: 650,
  RESPAWN_COOLDOWN_MS: 3_000,
  COUNTDOWN_MS: 3_000,
  ROUND_RESULT_MS: 3_500,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  SERVER_UPDATE_MS: 50,
  MOVES_PER_SECOND: 12,
  RECONNECT_GRACE_MS: 10_000,
  TRANSITION_TIMEOUT_MS: 15_000,
  COIN_VALUES: [1, 3, 5] as const,
  /**
   * The row band each coin value may occupy. The bands are ordered low to
   * high so the 1-point coin is in the lower area, the 3-point coin in the
   * middle, and the 5-point coin in the dangerous upper area.
   */
  COIN_ROW_BANDS: {
    1: [5, 6],
    3: [10, 11],
    5: [15, 16],
  } as const,
  /** Forgiving collision margins, in grid cells, applied to both shapes. */
  VEHICLE_COLLISION_MARGIN: 0.18,
  PLAYER_COLLISION_MARGIN: 0.3,
} as const;

export type CoinRushConstants = typeof COIN_RUSH_CONSTANTS;

// --- Shared grid helpers ---

export function coinRushCellId(col: number, row: number): string {
  return `${col}:${row}`;
}

export function manhattanDistance(
  a: { col: number; row: number },
  b: { col: number; row: number },
): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

export function coinRushClamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function coinRushLerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Left edge of the vehicle stream for a road row at the authoritative elapsed
 * time. The stream repeats every `spacing` cells; a positive direction moves
 * right, a negative direction moves left. Safe rows return 0 because they
 * have no vehicles.
 */
export function vehicleLeftEdge(
  row: Pick<CoinRushRowState, "direction" | "speed" | "offset" | "spacing">,
  elapsedMs: number,
): number {
  if (row.direction === 0 || row.spacing <= 0) {
    return 0;
  }
  const travel = (row.speed * elapsedMs) / 1000;
  const raw = row.direction > 0 ? row.offset + travel : row.offset - travel;
  const wrapped = raw % row.spacing;
  return wrapped < 0 ? wrapped + row.spacing : wrapped;
}

// --- Synchronized Colyseus state ---

export class CoinRushPlayerState extends Schema {
  @type("string") name = "";
  @type("boolean") connected = true;
  @type("number") joinedOrder = 0;
  @type("string") color = "";
  @type("boolean") alive = false;
  @type("boolean") respawning = false;
  @type("number") respawnEndsAt = 0;
  @type("boolean") moving = false;
  @type("boolean") push = false;
  @type("boolean") bouncing = false;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") fromX = 0;
  @type("number") fromY = 0;
  @type("number") toX = 0;
  @type("number") toY = 0;
  @type("number") moveStartedAt = 0;
  @type("number") moveEndsAt = 0;
  @type("number") bounceStartedAt = 0;
  @type("number") bounceEndsAt = 0;
  @type("string") deathType: CoinRushDeathType = "";
  @type("number") diedAt = 0;
  @type("number") score = 0;
  @type("number") roundWins = 0;
  @type("number") totalCoins = 0;
  @type("number") deaths = 0;
  @type("boolean") suddenDeathEligible = false;
}

export class CoinRushRowState extends Schema {
  @type("number") row = 0;
  @type("string") terrain: CoinRushTerrain = "safe";
  @type("number") direction = 0;
  @type("number") speed = 0;
  @type("number") vehicleLength = 0;
  @type("number") spacing = 0;
  @type("number") offset = 0;
}

export class CoinRushCoinState extends Schema {
  @type("number") value = 0;
  @type("number") col = 0;
  @type("number") row = 0;
  /** Absolute epoch ms when the replacement coin pops into view. */
  @type("number") visibleAt = 0;
}

export class CoinRushResultEntryState extends Schema {
  @type("string") sessionId = "";
  @type("number") rank = 0;
  @type("number") roundWins = 0;
  @type("number") totalCoins = 0;
  @type("number") deaths = 0;
  @type("string") label = "";
}

/** Final match result, synchronized while the room is finished. */
export class CoinRushResultState extends Schema {
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([CoinRushResultEntryState]) leaderboard = new ArraySchema<CoinRushResultEntryState>();
}

/**
 * Synchronized Coin Rush room state.
 *
 * Only public round facts are exposed: phase, round number, deadlines,
 * elapsed time, the generated map, coins, per-player positions and scores.
 * The seed, RNG, pending move queue, sequence windows, rate-limit state,
 * respawn candidate rolls, and sudden-death resolution internals stay outside
 * the schema.
 */
export class CoinRushState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: CoinRushPhase = "lobby";
  @type("number") roundNumber = 0;
  @type("number") totalRounds = 0;
  /** Absolute epoch ms when the countdown ends; 0 outside countdown. */
  @type("number") countdownEndsAt = 0;
  /** Absolute epoch ms when the round-result screen advances. */
  @type("number") roundResultEndsAt = 0;
  /** Authoritative round elapsed ms used for vehicle positions. */
  @type("number") elapsedMs = 0;
  @type("boolean") suddenDeath = false;
  @type([CoinRushRowState]) rows = new ArraySchema<CoinRushRowState>();
  @type({ map: CoinRushCoinState }) coins = new MapSchema<CoinRushCoinState>();
  @type({ map: CoinRushPlayerState }) players = new MapSchema<CoinRushPlayerState>();
  @type(["string"]) roundWinnerSessionIds = new ArraySchema<string>();
  @type(CoinRushResultState) result: CoinRushResultState | null = null;
}
