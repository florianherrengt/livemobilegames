import { addPlayer, createRuntime } from "../../../src/games/falling-platforms/engine.js";
import { createMatchRng } from "../../../src/games/falling-platforms/rng.js";
import { buildSettings } from "../../../src/games/falling-platforms/settings.js";
import { createPlatforms } from "../../../src/games/falling-platforms/spawning.js";
import type {
  MatchRuntime,
  MatchSettings,
  RuntimePlatform,
  RuntimePlayer,
} from "../../../src/games/falling-platforms/types.js";

export function makeRuntime(overrides: Partial<MatchSettings> = {}): MatchRuntime {
  const settings: MatchSettings = {
    ...buildSettings({ e2eMode: overrides.e2eMode ?? false }),
    ...overrides,
  };
  const runtime = createRuntime(settings);
  runtime.arenaSide = 7;
  runtime.platforms = new Map(createPlatforms(7).map((platform) => [platform.id, platform]));
  runtime.phase = "playing";
  runtime.matchStartedAt = 0;
  runtime.nextWarningAt = 1_000;
  runtime.rng = createMatchRng("unit-test-seed");
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
