import {
  FallingPlatformPlatformState,
  FallingPlatformsPlayerState,
  type FallingPlatformsState,
} from "@phone-party/protocol";

import type { MatchRuntime, RuntimePlatform, RuntimePlayer } from "./types.js";

function copyPlayer(target: FallingPlatformsPlayerState, source: RuntimePlayer): void {
  target.name = source.name;
  target.connected = source.connected;
  target.participating = source.participating;
  target.alive = source.alive;
  target.jumping = source.jumping;
  target.currentPlatformId = source.currentPlatformId;
  target.fromPlatformId = source.fromPlatformId;
  target.targetPlatformId = source.targetPlatformId;
  target.jumpStartedAt = source.jumpStartedAt;
  target.jumpEndsAt = source.jumpEndsAt;
  target.lastAcceptedSequence = source.lastAcceptedSequence;
  target.joinedOrder = source.joinedOrder;
}

function copyPlatform(target: FallingPlatformPlatformState, source: RuntimePlatform): void {
  target.id = source.id;
  target.gridX = source.gridX;
  target.gridY = source.gridY;
  target.state = source.state;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes client-facing Falling Platforms state, and it never
 * exposes the seed, RNG, gone deadlines, countdown/results deadlines, next
 * warning time, or first-removal flag.
 */
export function syncFallingPlatformsState(
  state: FallingPlatformsState,
  runtime: MatchRuntime,
): void {
  state.phase = runtime.phase;
  state.winnerSessionId = runtime.winnerSessionId;
  state.draw = runtime.draw;
  state.roundNumber = runtime.roundNumber;
  state.aliveCount = runtime.aliveCount;
  state.arenaSide = runtime.arenaSide;
  state.matchStartedAt = runtime.matchStartedAt;

  for (const [sessionId, player] of runtime.players) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new FallingPlatformsPlayerState();
      state.players.set(sessionId, playerState);
    }
    copyPlayer(playerState, player);
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.players.has(key)) {
      state.players.delete(key);
    }
  }

  for (const [id, platform] of runtime.platforms) {
    let platformState = state.platforms.get(id);
    if (!platformState) {
      platformState = new FallingPlatformPlatformState();
      state.platforms.set(id, platformState);
    }
    copyPlatform(platformState, platform);
  }
  for (const key of [...state.platforms.keys()]) {
    if (!runtime.platforms.has(key)) {
      state.platforms.delete(key);
    }
  }
}
