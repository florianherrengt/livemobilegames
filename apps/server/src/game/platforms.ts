import { type DifficultyStep, E2E_FIRST_TARGET } from "@falling-platforms/shared";

import { shuffle } from "./spawning.js";
import type { MatchRuntime } from "./types.js";

/** Marks every due warning platform as gone and returns the newly gone ids. */
export function transitionWarningsToGone(runtime: MatchRuntime, now: number): string[] {
  const gone: string[] = [];
  for (const platform of runtime.platforms.values()) {
    if (platform.state === "warning" && platform.goneAt > 0 && now >= platform.goneAt) {
      platform.state = "gone";
      gone.push(platform.id);
    }
  }
  return gone;
}

export function difficultyStepFor(runtime: MatchRuntime, now: number): DifficultyStep {
  const elapsedSeconds = (now - runtime.matchStartedAt) / 1000;
  for (const step of runtime.settings.schedule) {
    if (elapsedSeconds < step.untilSeconds) {
      return step;
    }
  }
  const schedule = runtime.settings.schedule;
  const last = schedule[schedule.length - 1];
  if (!last) {
    throw new Error("difficulty schedule must not be empty");
  }
  return last;
}

/**
 * Deterministically selects a batch of stable platforms and marks them as
 * warning. Never picks the same platform twice in one batch. When more than one
 * grounded survivor exists, the batch leaves at least one of their current
 * platforms unselected.
 */
export function selectBatch(
  runtime: MatchRuntime,
  stableIds: readonly string[],
  batchSize: number,
): string[] {
  const shuffled = shuffle(stableIds, runtime.rng);
  const count = Math.min(batchSize, shuffled.length);
  const selected = shuffled.slice(0, count);

  if (
    runtime.settings.e2eMode &&
    !runtime.firstRemovalCycleDone &&
    stableIds.includes(E2E_FIRST_TARGET) &&
    !selected.includes(E2E_FIRST_TARGET) &&
    selected.length < shuffled.length
  ) {
    selected[selected.length - 1] = E2E_FIRST_TARGET;
  }

  const groundedSurvivors = [...runtime.players.values()].filter(
    (player) => player.participating && player.alive && !player.jumping,
  );
  const survivorPlatformIds = [
    ...new Set(groundedSurvivors.map((player) => player.currentPlatformId)),
  ];
  const stableSurvivorIds = survivorPlatformIds.filter((id) => stableIds.includes(id));

  if (stableSurvivorIds.length > 1 && stableSurvivorIds.every((id) => selected.includes(id))) {
    const spare = shuffled.slice(count).find((id) => !selected.includes(id));
    if (spare) {
      for (let i = selected.length - 1; i >= 0; i--) {
        const selectedId = selected[i];
        if (selectedId && stableSurvivorIds.includes(selectedId)) {
          selected[i] = spare;
          break;
        }
      }
    }
  }

  return selected;
}

/** Warns the next batch of platforms and schedules their removal. */
export function selectAndWarnPlatforms(runtime: MatchRuntime, now: number): void {
  const step = difficultyStepFor(runtime, now);
  const stableIds = [...runtime.platforms.values()]
    .filter((platform) => platform.state === "stable")
    .map((platform) => platform.id);

  for (const id of selectBatch(runtime, stableIds, step.batchSize)) {
    const platform = runtime.platforms.get(id);
    if (platform) {
      platform.state = "warning";
      platform.goneAt = now + runtime.settings.platformWarningMs;
    }
  }

  runtime.nextWarningAt = now + step.intervalMs;
  runtime.firstRemovalCycleDone = true;
}
