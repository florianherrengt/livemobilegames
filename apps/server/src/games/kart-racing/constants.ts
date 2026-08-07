import { KART_RACING_CONSTANTS } from "@phone-party/protocol";

/**
 * Tunable Kart Racing server constants. Shared defaults come from the
 * protocol table; E2E overrides and server-only simulation safeguards live
 * here and are never exposed to clients.
 */
export const KART_RACING_SERVER_CONSTANTS = {
  ...KART_RACING_CONSTANTS,
  /** Multiplies speed, acceleration, steering, and projectile speed in E2E. */
  E2E_PHYSICS_SCALE: 3,
  E2E_COUNTDOWN_MS: 700,
  E2E_RESULTS_MS: 800,
  E2E_RACE_FINISH_TIMEOUT_MS: 12_000,
  E2E_ACTIVE_CRATE_COUNT: 6,
  E2E_RACE_SEED: "kart-racing-e2e-deterministic",
  MAX_CATCH_UP_MS: 250,
  WALL_RADIUS: 12,
  STUCK_DETECT_MS: 2_000,
  STUCK_SPEED_THRESHOLD: 12,
  WRONG_WAY_DETECT_MS: 1_200,
  WRONG_WAY_CLEAR_MS: 500,
  CRATE_MIN_SPACING: 180,
  RESPAWN_AHEAD_STEP_MS: 40,
  RESPAWN_SEARCH_DISTANCE: 240,
} as const;

export type KartRacingServerConstants = typeof KART_RACING_SERVER_CONSTANTS;

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
