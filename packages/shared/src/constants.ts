/**
 * Shared gameplay and protocol constants. All timings that matter for gameplay
 * live here so the server and client can never drift apart.
 */

export const TILE_SIZE = 52;
export const TILE_GAP = 6;
export const TILE_PITCH = TILE_SIZE + TILE_GAP;

export const HOP_DURATION_MS = 360;
export const JUMP_VISUAL_HEIGHT = 46;

export const PLATFORM_WARNING_MS = 900;
export const INITIAL_SAFE_PERIOD_MS = 2_000;

export const COUNTDOWN_MS = 3_000;
export const RESULTS_DISPLAY_MS = 5_000;
export const RECONNECT_GRACE_MS = 10_000;

export const SERVER_UPDATE_MS = 50;

export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 20;

export const MIN_PLAYERS = 2;

/** Generous cap: a player can never legitimately hop more often than this. */
export const HOP_MESSAGES_PER_SECOND = 12;

export const ROOM_CODE_LENGTH = 5;

export type DifficultyStep = {
  /** Match elapsed seconds covered by this step (Infinity for the last step). */
  untilSeconds: number;
  batchSize: number;
  intervalMs: number;
};

export const DIFFICULTY_SCHEDULE: DifficultyStep[] = [
  { untilSeconds: 10, batchSize: 1, intervalMs: 1_400 },
  { untilSeconds: 25, batchSize: 1, intervalMs: 950 },
  { untilSeconds: 40, batchSize: 2, intervalMs: 900 },
  { untilSeconds: 60, batchSize: 2, intervalMs: 650 },
  { untilSeconds: Number.POSITIVE_INFINITY, batchSize: 3, intervalMs: 500 },
];

/** E2E test-mode overrides. Guarded by E2E_TEST_MODE on the server only. */
export const E2E_MATCH_SEED = "e2e-deterministic-seed";
export const E2E_COUNTDOWN_MS = 500;
export const E2E_INITIAL_SAFE_PERIOD_MS = 1_200;
export const E2E_PLATFORM_WARNING_MS = 800;
export const E2E_REMOVAL_INTERVAL_MS = 1_500;
export const E2E_SPAWNS = ["3:3", "3:4"];
/** Player two's spawn is the first occupied platform that warns in test mode. */
export const E2E_FIRST_TARGET = "3:4";
