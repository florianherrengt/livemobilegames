import {
  PongBallState,
  PongLeaderboardEntryState,
  PongPlayerState,
  PongResultState,
  type PongState,
} from "@phone-party/protocol";

import type { PongRuntime, RuntimeBall, RuntimePlayer } from "./types.js";

function copyPlayer(target: PongPlayerState, source: RuntimePlayer): void {
  target.name = source.name;
  target.connectionStatus = source.connected ? "connected" : "reconnecting";
  target.joinedOrder = source.joinedOrder;
  target.color = source.color;
  target.worldEdge = source.worldEdge;
  target.slotIndex = source.slotIndex;
  target.openingStart = source.openingStart;
  target.openingEnd = source.openingEnd;
  target.paddleMin = source.paddleMin;
  target.paddleMax = source.paddleMax;
  target.paddleLength = source.paddleLength;
  target.paddleCenter = source.paddleCenter;
  target.score = source.score;
  target.lastAcceptedSequence = source.lastAcceptedSequence;
}

function copyBall(target: PongBallState, source: RuntimeBall): void {
  target.id = source.id;
  target.x = source.x;
  target.y = source.y;
  // A warning ball has no launch velocity yet; its direction is server-only.
  target.vx = source.state === "moving" ? source.vx : 0;
  target.vy = source.state === "moving" ? source.vy : 0;
  target.ownerSessionId = source.ownerSessionId;
  target.spawnState = source.state;
  target.spawnsAt = source.state === "warning" ? source.spawnsAt : 0;
}

function toResultState(result: NonNullable<PongRuntime["result"]>): PongResultState {
  const state = new PongResultState();
  for (const sessionId of result.winnerSessionIds) {
    state.winnerSessionIds.push(sessionId);
  }
  for (const entry of result.leaderboard) {
    const leaderboardEntry = new PongLeaderboardEntryState();
    leaderboardEntry.sessionId = entry.sessionId;
    leaderboardEntry.rank = entry.rank;
    leaderboardEntry.score = entry.score;
    leaderboardEntry.label = entry.label;
    state.leaderboard.push(leaderboardEntry);
  }
  return state;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes client-facing Pong state, and it never exposes the
 * seed, RNG, pending input targets, sequence windows, rate-limit state,
 * simulation accumulators, or hidden launch directions.
 */
export function syncPongState(state: PongState, runtime: PongRuntime): void {
  state.phase = runtime.phase;
  state.countdownEndsAt = runtime.phase === "countdown" ? runtime.countdownEndsAt : 0;
  state.matchElapsedMs =
    runtime.phase === "running" || runtime.phase === "finished" ? runtime.matchElapsedMs : 0;
  state.ballSpeed =
    runtime.phase === "countdown" || runtime.phase === "running" || runtime.phase === "finished"
      ? runtime.ballSpeed
      : 0;
  state.paddleSpeed =
    runtime.phase === "countdown" || runtime.phase === "running" || runtime.phase === "finished"
      ? runtime.paddleSpeed
      : 0;
  state.desiredBallCount =
    runtime.phase === "running" || runtime.phase === "finished"
      ? runtime.desiredBallCount
      : runtime.phase === "countdown"
        ? 1
        : 0;
  state.lastGoalDefenderSessionId = runtime.lastGoalDefenderSessionId;
  state.lastGoalScorerSessionId = runtime.lastGoalScorerSessionId;
  state.lastGoalAt = runtime.lastGoalAt;

  for (const [sessionId, player] of runtime.players) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new PongPlayerState();
      state.players.set(sessionId, playerState);
    }
    copyPlayer(playerState, player);
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.players.has(key)) {
      state.players.delete(key);
    }
  }

  for (const [ballId, ball] of runtime.balls) {
    let ballState = state.balls.get(ballId);
    if (!ballState) {
      ballState = new PongBallState();
      state.balls.set(ballId, ballState);
    }
    copyBall(ballState, ball);
  }
  for (const key of [...state.balls.keys()]) {
    if (!runtime.balls.has(key)) {
      state.balls.delete(key);
    }
  }

  if (runtime.result === null) {
    state.result = null;
  } else if (state.result === null) {
    state.result = toResultState(runtime.result);
  }
}
