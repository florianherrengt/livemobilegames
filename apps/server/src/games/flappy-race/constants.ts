import { FLAPPY_RACE_CONSTANTS } from "@phone-party/protocol";

/**
 * Tunable Flappy Race constants. Production geometry comes from the shared
 * protocol contract; simulation, timing, input protection, and E2E overrides
 * are server-only and never exposed to clients.
 */
export const FLAPPY_RACE_SERVER_CONSTANTS = {
  ...FLAPPY_RACE_CONSTANTS,
  GRAVITY: 1900,
  FLAP_IMPULSE: 430,
  MAX_FALL_SPEED: 560,
  COUNTDOWN_MS: 3_000,
  ROUND_RESULT_MS: 3_000,
  SIMULATION_STEP_MS: 30,
  SERVER_UPDATE_MS: 50,
  MAX_CATCH_UP_MS: 250,
  MAX_FLAPS_PER_SECOND: 20,
  TOTAL_ROUNDS: 5,
  RECONNECT_GRACE_MS: 10_000,
  TRANSITION_TIMEOUT_MS: 15_000,
  E2E_COUNTDOWN_MS: 700,
  E2E_ROUND_RESULT_MS: 800,
  E2E_COURSE_SPEED: 450,
  E2E_COURSE_SEED: "flappy-race-e2e-deterministic",
} as const;

export type FlappyRaceServerConstants = typeof FLAPPY_RACE_SERVER_CONSTANTS;

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
