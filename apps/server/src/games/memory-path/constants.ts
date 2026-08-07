import { MEMORY_PATH_CONSTANTS } from "@phone-party/protocol";

/**
 * Tunable Memory Path constants. Production geometry and gameplay timings
 * come from the shared protocol contract; simulation cadence, input
 * protection, reconnection, path-width tolerance, and E2E overrides are
 * server-only and never exposed to clients.
 */
export const MEMORY_PATH_SERVER_CONSTANTS = {
  ...MEMORY_PATH_CONSTANTS,
  /** Extra corridor beyond the visible edge accepted for the centre point. */
  PATH_WIDTH_TOLERANCE_FRACTION: 0.08,
  SERVER_UPDATE_MS: 50,
  MOVE_MESSAGES_PER_SECOND: 30,
  MAX_CATCH_UP_MS: 250,
  RECONNECT_GRACE_MS: 10_000,
  TRANSITION_TIMEOUT_MS: 15_000,
  E2E_PREPARING_MS: 400,
  E2E_PREVIEW_MS: 1_200,
  E2E_RACE_MS: 15_000,
  E2E_ROUND_RESULT_MS: 600,
  E2E_FLASH_INTERVAL_MS: 4_000,
  E2E_FLASH_DURATION_MS: 600,
  E2E_MOVEMENT_SPEED: 130,
  E2E_SEED: "memory-path-e2e-deterministic",
} as const;

export type MemoryPathServerConstants = typeof MEMORY_PATH_SERVER_CONSTANTS;

/**
 * Curated colour-blind conscious palette (Okabe-Ito). Assigned by the server
 * at match start and kept stable for the whole match.
 */
export const PLAYER_COLORS = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#D55E00",
  "#F0E442",
  "#882255",
] as const;

export function playerColorFor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length] ?? PLAYER_COLORS[0] ?? "#ffffff";
}
