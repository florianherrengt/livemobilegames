import { PONG_CONSTANTS } from "@phone-party/protocol";

/**
 * Tunable Pong constants. Production geometry and rules come from the shared
 * protocol contract; simulation, timing, input protection, and E2E overrides
 * are server-only and never exposed to clients.
 */
export const PONG_SERVER_CONSTANTS = {
  ...PONG_CONSTANTS,
  SIMULATION_STEP_MS: 10,
  SERVER_UPDATE_MS: 50,
  MAX_CATCH_UP_MS: 250,
  COUNTDOWN_MS: 3_000,
  MAX_PADDLE_MESSAGES_PER_SECOND: 120,
  SEQUENCE_WINDOW: 128,
  RECONNECT_GRACE_MS: 10_000,
  TRANSITION_TIMEOUT_MS: 15_000,
  E2E_COUNTDOWN_MS: 500,
  E2E_SPAWN_WARNING_MS: 250,
  E2E_ESCALATION_INTERVAL_MS: 600,
  E2E_BALL_SPEED: 1_800,
  E2E_PADDLE_CROSS_TIME_SECONDS: 0.12,
  E2E_SPAWN_RADIUS: 0,
  E2E_SEED: "pong-e2e-deterministic",
} as const;

export type PongServerConstants = typeof PONG_SERVER_CONSTANTS;

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
