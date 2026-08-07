import { LIVE_DRAWING_GUESSING_CONSTANTS } from "@phone-party/protocol";

/**
 * Tunable Live Drawing and Guessing constants. Production timing and limits
 * come from the shared protocol contract; server-only timings and E2E
 * overrides live here and are never exposed to clients.
 */
export const LIVE_DRAWING_GUESSING_SERVER_CONSTANTS = {
  ...LIVE_DRAWING_GUESSING_CONSTANTS,
  TICK_MS: 50,
  RECONNECT_GRACE_MS: 10_000,
  TRANSITION_TIMEOUT_MS: 15_000,
  E2E_PREPARATION_MS: 300,
  E2E_TURN_DURATION_MS: 1_500,
  E2E_RESULT_MS: 300,
  E2E_ROUND_SUMMARY_MS: 300,
  E2E_DRAWER_HOLD_MS: 800,
  E2E_ORDER_SEED: "live-drawing-guessing-e2e-order",
  E2E_WORD_SEED: "live-drawing-guessing-e2e-words",
} as const;

export type LiveDrawingGuessingServerConstants = typeof LIVE_DRAWING_GUESSING_SERVER_CONSTANTS;
