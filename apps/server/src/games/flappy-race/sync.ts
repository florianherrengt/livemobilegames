import {
  FlappyRaceLeaderboardEntryState,
  FlappyRacePlayerState,
  FlappyRaceResultState,
  type FlappyRaceState,
} from "@phone-party/protocol";

import type { FlappyRaceRuntime } from "./types.js";

function copyPlayer(
  target: FlappyRacePlayerState,
  source: {
    name: string;
    connected: boolean;
    joinedOrder: number;
    color: string;
    roundWins: number;
    clearedObstacleCount: number;
    roundActive: boolean;
    eliminated: boolean;
    eligible: boolean;
    birdY: number;
    birdVy: number;
  },
): void {
  target.name = source.name;
  target.connectionStatus = source.connected ? "connected" : "reconnecting";
  target.joinedOrder = source.joinedOrder;
  target.color = source.color;
  target.roundWins = source.roundWins;
  target.clearedObstacleCount = source.clearedObstacleCount;
  target.roundActive = source.roundActive;
  target.eliminated = source.eliminated;
  target.matchRemoved = !source.eligible;
  target.birdY = source.birdY;
  target.birdVy = source.birdVy;
}

function toResultState(result: NonNullable<FlappyRaceRuntime["result"]>): FlappyRaceResultState {
  const state = new FlappyRaceResultState();
  for (const sessionId of result.winnerSessionIds) {
    state.winnerSessionIds.push(sessionId);
  }
  for (const entry of result.leaderboard) {
    const leaderboardEntry = new FlappyRaceLeaderboardEntryState();
    leaderboardEntry.sessionId = entry.sessionId;
    leaderboardEntry.rank = entry.rank;
    leaderboardEntry.primaryScore = entry.primaryScore;
    leaderboardEntry.label = entry.label;
    state.leaderboard.push(leaderboardEntry);
  }
  return state;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes client-facing Flappy Race state, and it never exposes
 * the seed, RNG, pending flap queues, sequence windows, rate-limit state, or
 * simulation accumulators.
 */
export function syncFlappyRaceState(state: FlappyRaceState, runtime: FlappyRaceRuntime): void {
  const roundChanged = state.roundNumber !== runtime.roundNumber;
  state.phase = runtime.phase;
  state.roundNumber = runtime.roundNumber;
  state.totalRounds = runtime.totalRounds;
  state.countdownEndsAt = runtime.phase === "countdown" ? runtime.countdownEndsAt : 0;
  state.courseElapsedMs =
    runtime.phase === "countdown" ||
    runtime.phase === "running" ||
    runtime.phase === "round-result" ||
    runtime.phase === "finished"
      ? runtime.courseElapsedMs
      : 0;
  state.resultsEndsAt = runtime.phase === "round-result" ? runtime.resultsEndsAt : 0;
  state.courseSpeed = runtime.phase === "lobby" ? 0 : runtime.settings.courseSpeed;

  if (runtime.phase === "lobby") {
    state.obstacleOpenings.clear();
  } else if (roundChanged || state.obstacleOpenings.length === 0) {
    state.obstacleOpenings.clear();
    for (const opening of runtime.openings) {
      state.obstacleOpenings.push(opening);
    }
  }

  if (runtime.phase === "round-result" || runtime.phase === "finished" || roundChanged) {
    state.roundWinnerSessionIds.clear();
    for (const sessionId of runtime.roundWinnerSessionIds) {
      state.roundWinnerSessionIds.push(sessionId);
    }
  } else if (state.roundWinnerSessionIds.length > 0) {
    state.roundWinnerSessionIds.clear();
  }

  for (const [sessionId, player] of runtime.players) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new FlappyRacePlayerState();
      state.players.set(sessionId, playerState);
    }
    copyPlayer(playerState, player);
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.players.has(key)) {
      state.players.delete(key);
    }
  }

  if (runtime.result === null) {
    state.result = null;
  } else if (state.result === null) {
    state.result = toResultState(runtime.result);
  }
}
