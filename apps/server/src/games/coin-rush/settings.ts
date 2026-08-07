import { COIN_RUSH_CONSTANTS } from "@phone-party/protocol";

import { COIN_RUSH_SERVER_CONSTANTS } from "./constants.js";
import type { CoinRushSettings } from "./types.js";

export function buildSettings(e2eMode: boolean): CoinRushSettings {
  if (e2eMode) {
    return {
      e2eMode: true,
      countdownMs: COIN_RUSH_SERVER_CONSTANTS.E2E_COUNTDOWN_MS,
      roundResultMs: COIN_RUSH_SERVER_CONSTANTS.E2E_ROUND_RESULT_MS,
      moveDurationMs: COIN_RUSH_SERVER_CONSTANTS.E2E_MOVE_DURATION_MS,
      pushDurationMs: COIN_RUSH_SERVER_CONSTANTS.E2E_PUSH_DURATION_MS,
      bounceDurationMs: COIN_RUSH_SERVER_CONSTANTS.E2E_BOUNCE_DURATION_MS,
      coinPopMs: COIN_RUSH_SERVER_CONSTANTS.E2E_COIN_POP_MS,
      deathAnimationMs: COIN_RUSH_SERVER_CONSTANTS.E2E_DEATH_ANIMATION_MS,
      respawnCooldownMs: COIN_RUSH_SERVER_CONSTANTS.E2E_RESPAWN_COOLDOWN_MS,
      movesPerSecond: COIN_RUSH_CONSTANTS.MOVES_PER_SECOND,
    };
  }
  return {
    e2eMode: false,
    countdownMs: COIN_RUSH_CONSTANTS.COUNTDOWN_MS,
    roundResultMs: COIN_RUSH_CONSTANTS.ROUND_RESULT_MS,
    moveDurationMs: COIN_RUSH_CONSTANTS.MOVE_DURATION_MS,
    pushDurationMs: COIN_RUSH_CONSTANTS.PUSH_DURATION_MS,
    bounceDurationMs: COIN_RUSH_CONSTANTS.BOUNCE_DURATION_MS,
    coinPopMs: COIN_RUSH_CONSTANTS.COIN_POP_MS,
    deathAnimationMs: COIN_RUSH_CONSTANTS.DEATH_ANIMATION_MS,
    respawnCooldownMs: COIN_RUSH_CONSTANTS.RESPAWN_COOLDOWN_MS,
    movesPerSecond: COIN_RUSH_CONSTANTS.MOVES_PER_SECOND,
  };
}
