import type {
  MatchRuntime,
  MatchSettings,
  RuntimePlatform,
  RuntimePlayer,
} from "@falling-platforms/shared";
import { DIFFICULTY_SCHEDULE, HOP_DURATION_MS } from "@falling-platforms/shared";
import seedrandom from "seedrandom";

import { addPlayer, createRuntime } from "../src/game/match.js";
import { createPlatforms } from "../src/game/spawning.js";

export function makeRuntime(overrides: Partial<MatchSettings> = {}): MatchRuntime {
  const settings: MatchSettings = {
    allowSolo: true,
    e2eMode: false,
    countdownMs: 3_000,
    initialSafePeriodMs: 2_000,
    platformWarningMs: 900,
    resultsDisplayMs: 5_000,
    hopDurationMs: HOP_DURATION_MS,
    schedule: DIFFICULTY_SCHEDULE,
    ...overrides,
  };
  const runtime = createRuntime(settings);
  runtime.arenaSide = 7;
  runtime.platforms = new Map(createPlatforms(7).map((platform) => [platform.id, platform]));
  runtime.phase = "playing";
  runtime.matchStartedAt = 0;
  runtime.nextWarningAt = 1_000;
  runtime.rng = seedrandom("unit-test-seed");
  return runtime;
}

export function addPlayerAt(
  runtime: MatchRuntime,
  sessionId: string,
  name: string,
  platformId: string,
): RuntimePlayer {
  const player = addPlayer(runtime, sessionId, name, runtime.players.size);
  player.participating = true;
  player.alive = true;
  player.currentPlatformId = platformId;
  return player;
}

export function platform(runtime: MatchRuntime, id: string): RuntimePlatform {
  const found = runtime.platforms.get(id);
  if (!found) {
    throw new Error(`missing platform ${id}`);
  }
  return found;
}

export function player(runtime: MatchRuntime, sessionId: string): RuntimePlayer {
  const found = runtime.players.get(sessionId);
  if (!found) {
    throw new Error(`missing player ${sessionId}`);
  }
  return found;
}
