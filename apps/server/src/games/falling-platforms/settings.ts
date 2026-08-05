import { type DifficultyStep, FALLING_PLATFORMS_CONSTANTS } from "@phone-party/protocol";

import { FALLING_PLATFORMS_SERVER_CONSTANTS } from "./constants.js";
import type { MatchSettings } from "./types.js";

const E2E_SCHEDULE: readonly DifficultyStep[] = [
  { untilSeconds: Number.POSITIVE_INFINITY, batchSize: 1, intervalMs: 1_500 },
];

export function buildSettings(options: { e2eMode: boolean }): MatchSettings {
  if (options.e2eMode) {
    return {
      e2eMode: true,
      countdownMs: FALLING_PLATFORMS_SERVER_CONSTANTS.E2E_COUNTDOWN_MS,
      initialSafePeriodMs: FALLING_PLATFORMS_SERVER_CONSTANTS.E2E_INITIAL_SAFE_PERIOD_MS,
      platformWarningMs: FALLING_PLATFORMS_SERVER_CONSTANTS.E2E_PLATFORM_WARNING_MS,
      resultsDisplayMs: FALLING_PLATFORMS_SERVER_CONSTANTS.E2E_RESULTS_DISPLAY_MS,
      hopDurationMs: FALLING_PLATFORMS_CONSTANTS.HOP_DURATION_MS,
      schedule: E2E_SCHEDULE,
    };
  }
  return {
    e2eMode: false,
    countdownMs: FALLING_PLATFORMS_CONSTANTS.COUNTDOWN_MS,
    initialSafePeriodMs: FALLING_PLATFORMS_CONSTANTS.INITIAL_SAFE_PERIOD_MS,
    platformWarningMs: FALLING_PLATFORMS_CONSTANTS.PLATFORM_WARNING_MS,
    resultsDisplayMs: FALLING_PLATFORMS_CONSTANTS.RESULTS_DISPLAY_MS,
    hopDurationMs: FALLING_PLATFORMS_CONSTANTS.HOP_DURATION_MS,
    schedule: FALLING_PLATFORMS_CONSTANTS.DIFFICULTY_SCHEDULE,
  };
}
