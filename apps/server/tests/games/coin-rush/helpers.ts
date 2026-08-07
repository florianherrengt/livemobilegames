import { COIN_RUSH_CONSTANTS } from "@phone-party/protocol";

import { addPlayer, createRuntime } from "../../../src/games/coin-rush/engine.js";
import { buildSettings } from "../../../src/games/coin-rush/settings.js";
import type {
  CoinRushRuntime,
  RuntimePlayer,
  RuntimeRow,
} from "../../../src/games/coin-rush/types.js";

export function makeRuntime(overrides: { e2eMode?: boolean } = {}): CoinRushRuntime {
  const runtime = createRuntime(buildSettings(overrides.e2eMode ?? false));
  runtime.rows = allSafeRows();
  return runtime;
}

export function allSafeRows(): RuntimeRow[] {
  return Array.from({ length: COIN_RUSH_CONSTANTS.ROW_COUNT }, (_, row) => ({
    row,
    terrain: "safe" as const,
    direction: 0 as const,
    speed: 0,
    vehicleLength: 0,
    spacing: 0,
    offset: 0,
  }));
}

export function addPlayerAt(
  runtime: CoinRushRuntime,
  sessionId: string,
  name: string,
  x: number,
  y: number,
): RuntimePlayer {
  const player = addPlayer(runtime, sessionId, name, runtime.players.size);
  player.alive = true;
  player.x = x;
  player.y = y;
  player.fromX = x;
  player.fromY = y;
  player.toX = x;
  player.toY = y;
  return player;
}

export function player(runtime: CoinRushRuntime, sessionId: string): RuntimePlayer {
  const found = runtime.players.get(sessionId);
  if (!found) {
    throw new Error(`missing player ${sessionId}`);
  }
  return found;
}

export function startPlayingRuntime(runtime: CoinRushRuntime, now: number): void {
  runtime.phase = "playing";
  runtime.roundNumber = 1;
  runtime.totalRounds = COIN_RUSH_CONSTANTS.TOTAL_ROUNDS;
  runtime.elapsedMs = 0;
  runtime.lastTickAt = now;
  for (const player of runtime.players.values()) {
    player.alive = true;
    player.score = 0;
  }
}
