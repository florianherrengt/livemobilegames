import { FALLING_PLATFORMS_CONSTANTS } from "@phone-party/protocol";

/**
 * Tunable Falling Platforms constants. Production durations come from the
 * shared protocol contract; integration and E2E tests receive the shortened
 * values through the trusted room options assembled by the platform lobby,
 * never through client input.
 */
export const FALLING_PLATFORMS_SERVER_CONSTANTS = {
  MIN_PLAYERS: FALLING_PLATFORMS_CONSTANTS.MIN_PLAYERS,
  MAX_PLAYERS: FALLING_PLATFORMS_CONSTANTS.MAX_PLAYERS,
  TRANSITION_TIMEOUT_MS: FALLING_PLATFORMS_CONSTANTS.TRANSITION_TIMEOUT_MS,
  RECONNECT_GRACE_MS: FALLING_PLATFORMS_CONSTANTS.RECONNECT_GRACE_MS,
  SERVER_UPDATE_MS: FALLING_PLATFORMS_CONSTANTS.SERVER_UPDATE_MS,
  HOP_DURATION_MS: FALLING_PLATFORMS_CONSTANTS.HOP_DURATION_MS,
  HOP_MESSAGES_PER_SECOND: FALLING_PLATFORMS_CONSTANTS.HOP_MESSAGES_PER_SECOND,
  E2E_MATCH_SEED: "e2e-deterministic-seed",
  E2E_COUNTDOWN_MS: 500,
  E2E_INITIAL_SAFE_PERIOD_MS: 1_200,
  E2E_PLATFORM_WARNING_MS: 800,
  E2E_REMOVAL_INTERVAL_MS: 1_500,
  E2E_RESULTS_DISPLAY_MS: 4_000,
  E2E_SPAWNS: ["3:3", "3:4"] as const,
  /** Player two's spawn is the first occupied platform that warns in test mode. */
  E2E_FIRST_TARGET: "3:4",
} as const;
