/**
 * Tunable game constants. Defaults mirror the original game; tests override
 * timings through GameDefinition options (e2eMode), not through these.
 */
export const CAPITAL_PIN_CONSTANTS = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  TOTAL_ROUNDS: 10,
  ROUND_DURATION_MS: 45_000,
  RESULTS_DURATION_MS: 8_000,
  E2E_ROUND_DURATION_MS: 2_000,
  E2E_RESULTS_DURATION_MS: 300,
  EARTH_RADIUS_KM: 6371.0088,
  /** Guesses within this distance (km) of the leading guess are tied winners. */
  DISTANCE_TIE_EPSILON_KM: 0.001,
  /** Penalty distance applied to a missed round so it never wins on distance. */
  MISSING_GUESS_DISTANCE_KM: 20_015,
} as const;
