import { MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

export const FALLING_PLATFORMS_GAME_ID = "falling-platforms";

// --- Phases and platform states ---

export const fallingPlatformsPhaseSchema = z.enum(["lobby", "countdown", "playing", "results"]);

export type FallingPlatformsPhase = z.infer<typeof fallingPlatformsPhaseSchema>;

export const platformStateValueSchema = z.enum(["stable", "warning", "gone"]);

export type PlatformStateValue = z.infer<typeof platformStateValueSchema>;

// --- Client commands ---

/**
 * The only Falling Platforms game command: hop to an adjacent platform. The
 * payload is pure intent: a client-chosen sequence for ordering and the target
 * tile. The server derives the actor from the connected client and validates
 * adjacency, occupancy, timing, and phase against authoritative state.
 *
 * The payload is strict so unknown fields cannot smuggle claimed positions,
 * outcomes, or identity into the room boundary.
 */
export const fallingPlatformHopSchema = z
  .object({
    type: z.literal("hop"),
    sequence: z.number().int().finite(),
    targetPlatformId: z.string().regex(/^\d+:\d+$/, "Invalid platform id"),
  })
  .strict();

export type FallingPlatformHop = z.infer<typeof fallingPlatformHopSchema>;

export const fallingPlatformsCommandSchema = z.discriminatedUnion("type", [
  fallingPlatformHopSchema,
]);

export type FallingPlatformsCommand = z.infer<typeof fallingPlatformsCommandSchema>;

export const hopRejectionReasonSchema = z.enum([
  "not-playing",
  "not-alive",
  "already-jumping",
  "invalid-target",
  "target-gone",
  "not-adjacent",
  "stale-sequence",
  "rate-limited",
  "target-occupied",
]);

export type HopRejectionReason = z.infer<typeof hopRejectionReasonSchema>;

/** Private hop rejection sent only to the player whose hop was refused. */
export const fallingPlatformHopRejectionSchema = z
  .object({
    sequence: z.number().int().finite(),
    reason: hopRejectionReasonSchema,
  })
  .strict();

export type FallingPlatformHopRejection = z.infer<typeof fallingPlatformHopRejectionSchema>;

export const FALLING_PLATFORMS_MESSAGE_TYPES = {
  hop: "game:hop",
  hopRejected: "hop-rejected",
} as const;

// --- Shared gameplay constants ---

export type DifficultyStep = {
  /** Match elapsed seconds covered by this step (Infinity for the last step). */
  untilSeconds: number;
  batchSize: number;
  intervalMs: number;
};

/**
 * Shared Falling Platforms gameplay constants. All timings that affect the
 * server-authoritative simulation live here so the server and web renderer
 * agree on tile geometry and hop animation. E2E timing overrides stay in the
 * server game constants module.
 */
export const FALLING_PLATFORMS_CONSTANTS = {
  TILE_SIZE: 104,
  TILE_GAP: 12,
  TILE_PITCH: 116,
  HOP_DURATION_MS: 360,
  JUMP_VISUAL_HEIGHT: 92,
  PLATFORM_WARNING_MS: 900,
  INITIAL_SAFE_PERIOD_MS: 2_000,
  COUNTDOWN_MS: 3_000,
  RESULTS_DISPLAY_MS: 5_000,
  SERVER_UPDATE_MS: 50,
  HOP_MESSAGES_PER_SECOND: 12,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  RECONNECT_GRACE_MS: 10_000,
  TRANSITION_TIMEOUT_MS: 15_000,
  DIFFICULTY_SCHEDULE: [
    { untilSeconds: 10, batchSize: 1, intervalMs: 1_400 },
    { untilSeconds: 25, batchSize: 1, intervalMs: 950 },
    { untilSeconds: 40, batchSize: 2, intervalMs: 900 },
    { untilSeconds: 60, batchSize: 2, intervalMs: 650 },
    { untilSeconds: Number.POSITIVE_INFINITY, batchSize: 3, intervalMs: 500 },
  ] as const satisfies readonly DifficultyStep[],
} as const;

// --- Pure grid helpers ---

export function platformId(gridX: number, gridY: number): string {
  return `${gridX}:${gridY}`;
}

export type PlatformIdParts = {
  gridX: number;
  gridY: number;
};

/** Parses a platform id of the form "gridX:gridY". Returns null for anything malformed. */
export function parsePlatformId(id: string): PlatformIdParts | null {
  const match = /^(\d+):(\d+)$/.exec(id);
  if (!match) {
    return null;
  }
  return {
    gridX: Number.parseInt(match[1] ?? "0", 10),
    gridY: Number.parseInt(match[2] ?? "0", 10),
  };
}

/** Chebyshev distance adjacency: horizontal, vertical and diagonal are all hops. */
export function isAdjacent(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): boolean {
  return Math.max(Math.abs(targetX - sourceX), Math.abs(targetY - sourceY)) === 1;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth ease-in-out used for hop interpolation. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Horizontal easing for hops (ease-out quad). Unlike easeInOut it starts with
 * real horizontal speed, so the character moves out of the tile immediately
 * while arcing instead of rising in place first.
 */
export function hopEaseOut(t: number): number {
  return t * (2 - t);
}

/**
 * Arena side length for a given number of participating players.
 * Keeps roughly six platforms per player with a 5x5 minimum so the grid
 * grows with the player count instead of staying fixed.
 */
export function computeArenaSide(playerCount: number): number {
  const desiredPlatformCount = Math.max(25, playerCount * 6);
  const side = Math.ceil(Math.sqrt(desiredPlatformCount));
  return side % 2 === 0 ? side + 1 : side;
}

/** Top-left world coordinate of the arena so its centre lands on (0, 0). */
export function arenaOriginX(
  arenaSide: number,
  pitch = FALLING_PLATFORMS_CONSTANTS.TILE_PITCH,
): number {
  return (-arenaSide * pitch) / 2;
}

export function arenaOriginY(
  arenaSide: number,
  pitch = FALLING_PLATFORMS_CONSTANTS.TILE_PITCH,
): number {
  return (-arenaSide * pitch) / 2;
}

/** World coordinates of a platform centre. */
export function platformCenterX(
  gridX: number,
  arenaSide: number,
  pitch = FALLING_PLATFORMS_CONSTANTS.TILE_PITCH,
): number {
  return arenaOriginX(arenaSide, pitch) + gridX * pitch + pitch / 2;
}

export function platformCenterY(
  gridY: number,
  arenaSide: number,
  pitch = FALLING_PLATFORMS_CONSTANTS.TILE_PITCH,
): number {
  return arenaOriginY(arenaSide, pitch) + gridY * pitch + pitch / 2;
}

// --- Synchronized Colyseus state ---

export class FallingPlatformsPlayerState extends Schema {
  @type("string") name = "";
  @type("boolean") connected = true;
  @type("boolean") participating = false;
  @type("boolean") alive = false;
  @type("boolean") jumping = false;
  @type("string") currentPlatformId = "";
  @type("string") fromPlatformId = "";
  @type("string") targetPlatformId = "";
  @type("number") jumpStartedAt = 0;
  @type("number") jumpEndsAt = 0;
  @type("number") lastAcceptedSequence = 0;
  @type("number") joinedOrder = 0;
}

export class FallingPlatformPlatformState extends Schema {
  @type("string") id = "";
  @type("number") gridX = 0;
  @type("number") gridY = 0;
  @type("string") state: PlatformStateValue = "stable";
}

/**
 * Synchronized Falling Platforms room state.
 *
 * Only public round facts are exposed: phase, alive count, platform states,
 * player membership and the current jump projection. The seed, RNG, gone
 * deadlines, countdown/results deadlines, next-warning time and first-removal
 * flag stay server-only and are never copied into this schema.
 */
export class FallingPlatformsState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: FallingPlatformsPhase = "lobby";
  @type("string") winnerSessionId = "";
  @type("boolean") draw = false;
  @type("number") roundNumber = 0;
  @type("number") aliveCount = 0;
  @type("number") arenaSide = 0;
  /** Absolute epoch ms when the current match started playing. 0 outside a match. */
  @type("number") matchStartedAt = 0;
  @type({ map: FallingPlatformsPlayerState }) players =
    new MapSchema<FallingPlatformsPlayerState>();
  @type({ map: FallingPlatformPlatformState }) platforms =
    new MapSchema<FallingPlatformPlatformState>();
}
