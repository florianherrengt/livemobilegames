import { GOLF_MAX_DRAG_PX, GOLF_TOTAL_ROUNDS } from "@phone-party/protocol";

/**
 * Tunable Golf constants. Shared drag/power geometry comes from the protocol
 * contract; simulation, timing, input protection, and E2E overrides are
 * server-only and never exposed to clients.
 */
export const GOLF_SERVER_CONSTANTS = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  TOTAL_ROUNDS: GOLF_TOTAL_ROUNDS,
  BALL_RADIUS: 18,
  MAX_SHOT_SPEED: 900,
  E2E_MAX_SHOT_SPEED: 1400,
  MIN_SHOT_SPEED: 150,
  MAX_DRAG_PX: GOLF_MAX_DRAG_PX,
  MIN_DRAG_PX: 16,
  DAMPING_PER_SECOND: 1.15,
  WALL_RESTITUTION: 0.74,
  BALL_RESTITUTION: 0.58,
  STOP_SPEED_THRESHOLD: 16,
  STOP_STABLE_MS: 350,
  SIMULATION_STEP_MS: 20,
  SERVER_UPDATE_MS: 50,
  MAX_CATCH_UP_MS: 250,
  AIM_MS: 7_000,
  COUNTDOWN_MS: 3_000,
  ROUND_RESULT_MS: 3_000,
  IMMUNITY_MS: 5_000,
  RECONNECT_GRACE_MS: 10_000,
  TRANSITION_TIMEOUT_MS: 15_000,
  E2E_AIM_MS: 500,
  E2E_COUNTDOWN_MS: 400,
  E2E_ROUND_RESULT_MS: 300,
  E2E_IMMUNITY_MS: 800,
} as const;

export type GolfServerConstants = typeof GOLF_SERVER_CONSTANTS;

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
