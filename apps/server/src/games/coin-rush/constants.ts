import { COIN_RUSH_CONSTANTS } from "@phone-party/protocol";

/**
 * Tunable Coin Rush constants. Production timings come from the shared
 * protocol contract; integration and E2E tests receive shortened values
 * through the trusted room options assembled by the platform lobby, never
 * through client input.
 */
export const COIN_RUSH_SERVER_CONSTANTS = {
  ...COIN_RUSH_CONSTANTS,
  E2E_COUNTDOWN_MS: 600,
  E2E_ROUND_RESULT_MS: 700,
  E2E_RESPAWN_COOLDOWN_MS: 700,
  E2E_DEATH_ANIMATION_MS: 300,
  E2E_COIN_POP_MS: 0,
  E2E_MOVE_DURATION_MS: 80,
  E2E_PUSH_DURATION_MS: 90,
  E2E_BOUNCE_DURATION_MS: 80,
  E2E_MATCH_SEED: "coin-rush-e2e-deterministic",
  E2E_ROAD_DENSITY: 0.3,
} as const;

export type CoinRushServerConstants = typeof COIN_RUSH_SERVER_CONSTANTS;

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
