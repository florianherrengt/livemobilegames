import {
  COUNTDOWN_MS,
  DIFFICULTY_SCHEDULE,
  type DifficultyStep,
  E2E_COUNTDOWN_MS,
  E2E_INITIAL_SAFE_PERIOD_MS,
  E2E_PLATFORM_WARNING_MS,
  E2E_REMOVAL_INTERVAL_MS,
  HOP_DURATION_MS,
  INITIAL_SAFE_PERIOD_MS,
  PLATFORM_WARNING_MS,
  RESULTS_DISPLAY_MS,
} from "@falling-platforms/shared";

import type { MatchSettings } from "./types.js";

const E2E_SCHEDULE: DifficultyStep[] = [
  { untilSeconds: Number.POSITIVE_INFINITY, batchSize: 1, intervalMs: E2E_REMOVAL_INTERVAL_MS },
];

export function buildSettings(): MatchSettings {
  const e2eMode = process.env.E2E_TEST_MODE === "true";
  const allowSolo = process.env.ALLOW_SOLO === "true";

  if (e2eMode) {
    return {
      allowSolo,
      e2eMode: true,
      countdownMs: E2E_COUNTDOWN_MS,
      initialSafePeriodMs: E2E_INITIAL_SAFE_PERIOD_MS,
      platformWarningMs: E2E_PLATFORM_WARNING_MS,
      resultsDisplayMs: 4_000,
      hopDurationMs: HOP_DURATION_MS,
      schedule: E2E_SCHEDULE,
    };
  }

  return {
    allowSolo,
    e2eMode: false,
    countdownMs: COUNTDOWN_MS,
    initialSafePeriodMs: INITIAL_SAFE_PERIOD_MS,
    platformWarningMs: PLATFORM_WARNING_MS,
    resultsDisplayMs: RESULTS_DISPLAY_MS,
    hopDurationMs: HOP_DURATION_MS,
    schedule: DIFFICULTY_SCHEDULE,
  };
}
