import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

export const KART_RACING_GAME_ID = "kart-racing";

// --- Phases ---

export const kartRacingPhaseSchema = z.enum([
  "lobby",
  "countdown",
  "racing",
  "race-result",
  "finished",
]);

export type KartRacingPhase = z.infer<typeof kartRacingPhaseSchema>;

// --- Client commands ---

/**
 * Steering intent. The payload carries only the relative steering amount the
 * player wants (-1 = hard left, 1 = hard right), a client-chosen sequence for
 * ordering, and the race the player believes is active. The server derives
 * the actor from the connected client and validates phase, membership,
 * sequence, race, and rate against authoritative state. It is strict so
 * unknown fields cannot smuggle positions, velocities, hits, scores,
 * identity, or outcomes into the room boundary.
 */
export const kartSteerCommandSchema = z
  .object({
    type: z.literal("steer"),
    sequence: z.number().int().finite().min(1),
    raceNumber: z.number().int().min(1),
    steering: z.number().min(-1).max(1),
  })
  .strict();

export type KartSteerCommand = z.infer<typeof kartSteerCommandSchema>;

/**
 * Shooting intent. The client detects a deliberate upward swipe and asks the
 * server to fire if the player is loaded and eligible. The payload contains
 * no projectile position or aim: the server owns the shot.
 */
export const kartShootCommandSchema = z
  .object({
    type: z.literal("shoot"),
    sequence: z.number().int().finite().min(1),
    raceNumber: z.number().int().min(1),
  })
  .strict();

export type KartShootCommand = z.infer<typeof kartShootCommandSchema>;

export const kartRacingCommandSchema = z.discriminatedUnion("type", [
  kartSteerCommandSchema,
  kartShootCommandSchema,
]);

export type KartRacingCommand = z.infer<typeof kartRacingCommandSchema>;

export const kartCommandRejectionReasonSchema = z.enum([
  "not-racing",
  "not-active",
  "old-race",
  "stale-sequence",
  "rate-limited",
  "no-ammo",
  "disabled",
]);

export type KartCommandRejectionReason = z.infer<typeof kartCommandRejectionReasonSchema>;

/** Private command rejection sent only to the player whose command was refused. */
export const kartCommandRejectionSchema = z
  .object({
    commandType: z.enum(["steer", "shoot"]),
    sequence: z.number().int().finite().min(1),
    raceNumber: z.number().int().min(1),
    reason: kartCommandRejectionReasonSchema,
  })
  .strict();

export type KartCommandRejection = z.infer<typeof kartCommandRejectionSchema>;

export const KART_RACING_MESSAGE_TYPES = {
  steer: "game:steer",
  shoot: "game:shoot",
  commandRejected: "game:command-rejected",
} as const;

// --- Shared gameplay constants ---

/**
 * Central tuning values for Kart Racing. Server simulation, E2E overrides,
 * and the browser gesture recogniser all read from this single shared table;
 * values here are the initial defaults from the game brief. E2E-only timing
 * overrides live in the server game constants module.
 */
export const KART_RACING_CONSTANTS = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  LAPS_PER_RACE: 3,
  RACES_PER_MATCH: 3,
  KART_RADIUS: 22,
  PROJECTILE_RADIUS: 6,
  CRATE_RADIUS: 26,
  PROJECTILE_SPAWN_AHEAD: 46,
  MAX_SPEED: 170,
  ACCELERATION: 95,
  STEERING_STRENGTH: 3.2,
  HIGH_SPEED_STEERING_REDUCTION: 0.35,
  WALL_SLOWDOWN: 0.55,
  PLAYER_PUSH_STRENGTH: 1.25,
  PROJECTILE_SPEED: 520,
  PROJECTILE_LIFETIME_MS: 1_200,
  HIT_STOP_MS: 1_000,
  HIT_IMMUNITY_MS: 1_000,
  RESPAWN_DELAY_MS: 1_000,
  RESPAWN_IMMUNITY_MS: 1_000,
  SLOW_TERRAIN_SPEED_MULTIPLIER: 0.65,
  COUNTDOWN_MS: 3_000,
  RESULTS_MS: 6_000,
  RACE_FINISH_TIMEOUT_MS: 30_000,
  ACTIVE_CRATE_COUNT: 6,
  SWIPE_DISTANCE_PX: 60,
  SWIPE_TIME_MS: 250,
  SWIPE_VERTICAL_RATIO: 2,
  STEER_MAX_OFFSET_PX: 80,
  STEERING_MESSAGES_PER_SECOND: 40,
  SHOOT_MESSAGES_PER_SECOND: 10,
  SIMULATION_STEP_MS: 25,
  SERVER_UPDATE_MS: 50,
  RECONNECT_GRACE_MS: 10_000,
  TRANSITION_TIMEOUT_MS: 15_000,
} as const;

export type KartRacingConstants = typeof KART_RACING_CONSTANTS;

export const KART_RACING_POINTS = [8, 6, 5, 4, 3, 2, 1, 0] as const;

// --- Synchronized Colyseus state ---

export class KartRacingPlayerState extends Schema {
  @type("string") name = "";
  @type("string") connectionStatus: "connected" | "reconnecting" | "disconnected" = "connected";
  @type("number") joinedOrder = 0;
  @type("string") color = "";
  @type("number") matchPoints = 0;
  @type("number") raceWins = 0;
  @type("number") secondPlaces = 0;
  @type("number") thirdPlaces = 0;
  @type("number") totalRaceTimeMs = 0;
  @type("number") kartX = 0;
  @type("number") kartY = 0;
  @type("number") kartHeading = 0;
  @type("number") kartSpeed = 0;
  /** Still part of the current race's ranking (never false for a removed player). */
  @type("boolean") raceActive = false;
  /** Kart is simulating and can drive, shoot, collide, and fall. */
  @type("boolean") active = false;
  @type("boolean") finished = false;
  @type("boolean") timedOut = false;
  /** Permanently left after the match started; kept for final results. */
  @type("boolean") removed = false;
  /** Display lap (1..3) while racing. */
  @type("number") lap = 0;
  /** Required checkpoints passed this lap (0..5). */
  @type("number") checkpointsPassed = 0;
  @type("number") racePosition = 0;
  @type("number") finishPosition = 0;
  @type("number") finishTimeMs = 0;
  /** Points awarded for the most recent race (shown on race results). */
  @type("number") racePoints = 0;
  @type("boolean") ammoLoaded = false;
  @type("number") hitStopRemainingMs = 0;
  @type("number") immunityRemainingMs = 0;
  @type("number") respawnRemainingMs = 0;
  @type("boolean") wrongWay = false;
  @type(["string"]) collectedCrateIds = new ArraySchema<string>();
}

export class KartRacingProjectileState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") heading = 0;
  @type("number") remainingMs = 0;
}

export class KartRacingCrateState extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
}

export class KartRacingRaceResultEntryState extends Schema {
  @type("string") sessionId = "";
  @type("string") label = "";
  @type("number") position = 0;
  @type("number") points = 0;
  @type("number") finishTimeMs = 0;
  @type("boolean") timedOut = false;
}

export class KartRacingLeaderboardEntryState extends Schema {
  @type("string") sessionId = "";
  @type("string") label = "";
  @type("number") rank = 0;
  @type("number") matchPoints = 0;
  @type("number") raceWins = 0;
  @type("number") totalRaceTimeMs = 0;
}

export class KartRacingMatchResultState extends Schema {
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([KartRacingLeaderboardEntryState]) leaderboard =
    new ArraySchema<KartRacingLeaderboardEntryState>();
}

/**
 * Synchronized Kart Racing room state.
 *
 * Only public race facts are exposed: phase, race number, deadlines, track
 * identity, per-player kart kinematics and progress, active crates,
 * projectiles, race results, and the final match result. The seed, RNG,
 * pending commands, sequence windows, rate-limit state, respawn points,
 * timers, and all other server-only simulation internals stay outside the
 * schema.
 */
export class KartRacingState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: KartRacingPhase = "lobby";
  @type("number") raceNumber = 0;
  @type("number") totalRaces = 0;
  @type("number") lapsPerRace = 0;
  /** Absolute epoch ms when the countdown ends; 0 outside countdown. */
  @type("number") countdownEndsAt = 0;
  /** Absolute epoch ms when the race-results screen advances; 0 outside results. */
  @type("number") resultsEndsAt = 0;
  /** Absolute epoch ms when the current race began; 0 outside racing. */
  @type("number") raceStartedAt = 0;
  /**
   * Absolute epoch ms for the hard race deadline. The server shortens this
   * deadline after the first finisher so remaining karts cannot stall results.
   */
  @type("number") raceFinishTimeoutEndsAt = 0;
  @type("string") trackId = "";
  @type("string") trackName = "";
  @type({ map: KartRacingPlayerState }) players = new MapSchema<KartRacingPlayerState>();
  @type([KartRacingCrateState]) crates = new ArraySchema<KartRacingCrateState>();
  @type([KartRacingProjectileState]) projectiles = new ArraySchema<KartRacingProjectileState>();
  @type([KartRacingRaceResultEntryState]) raceResult =
    new ArraySchema<KartRacingRaceResultEntryState>();
  @type(["string"]) raceFinishOrder = new ArraySchema<string>();
  @type(KartRacingMatchResultState) result: KartRacingMatchResultState | null = null;
}

export { KART_RACING_TRACK } from "./kart-racing-track.js";
