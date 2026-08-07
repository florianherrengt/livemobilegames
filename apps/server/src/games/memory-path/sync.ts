import {
  MEMORY_PATH_CONSTANTS,
  MemoryPathLandmarkState,
  MemoryPathLeaderboardEntryState,
  MemoryPathMatchResultState,
  MemoryPathPlayerState,
  MemoryPathPointState,
  MemoryPathRoundResultState,
  type MemoryPathState,
} from "@phone-party/protocol";

import type { MemoryPathRuntime, RuntimePlayer } from "./types.js";

function copyPlayer(target: MemoryPathPlayerState, source: RuntimePlayer): void {
  target.name = source.name;
  target.connectionStatus = source.connected ? "connected" : "reconnecting";
  target.joinedOrder = source.joinedOrder;
  target.color = source.color;
  target.roundWins = source.roundWins;
  target.participating = source.participating;
  target.roundActive = source.roundActive;
  target.finished = source.finished;
  target.falling = source.falling;
  target.respawnEndsAt = source.respawnEndsAt;
  target.positionX = source.position.x;
  target.positionY = source.position.y;
  target.progress = source.progress;
  target.maxProgress = source.maxProgress;
  target.falls = source.falls;
}

function copyRoundResult(
  target: MemoryPathRoundResultState,
  source: NonNullable<MemoryPathRuntime["roundResult"]>,
): void {
  target.roundNumber = source.roundNumber;
  target.winnerSessionIds.clear();
  for (const sessionId of source.winnerSessionIds) {
    target.winnerSessionIds.push(sessionId);
  }
  target.winnerLabel = source.winnerLabel;
  target.reason = source.reason;
  target.winnerProgress = source.winnerProgress;
  target.suddenDeath = source.suddenDeath;
}

function copyMatchResult(
  target: MemoryPathMatchResultState,
  source: NonNullable<MemoryPathRuntime["result"]>,
): void {
  target.winnerSessionIds.clear();
  for (const sessionId of source.winnerSessionIds) {
    target.winnerSessionIds.push(sessionId);
  }
  target.leaderboard.clear();
  for (const entry of source.leaderboard) {
    const leaderboardEntry = new MemoryPathLeaderboardEntryState();
    leaderboardEntry.sessionId = entry.sessionId;
    leaderboardEntry.rank = entry.rank;
    leaderboardEntry.roundWins = entry.roundWins;
    leaderboardEntry.label = entry.label;
    target.leaderboard.push(leaderboardEntry);
  }
  target.roundResults.clear();
  for (const round of source.roundResults) {
    const roundState = new MemoryPathRoundResultState();
    copyRoundResult(roundState, round);
    target.roundResults.push(roundState);
  }
  target.suddenDeathUsed = source.suddenDeathUsed;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes client-facing Memory Path state, and it never exposes
 * the seed, RNG, route pool, input sequences, rate-limit state, or simulation
 * accumulators.
 */
export function syncMemoryPathState(state: MemoryPathState, runtime: MemoryPathRuntime): void {
  const roundChanged = state.roundNumber !== runtime.roundNumber;
  state.phase = runtime.phase;
  state.roundNumber = runtime.roundNumber;
  state.totalRounds = runtime.totalRounds;
  state.suddenDeath = runtime.suddenDeath;
  state.preparingEndsAt = runtime.phase === "preparing" ? runtime.preparingEndsAt : 0;
  state.previewEndsAt = runtime.phase === "preview" ? runtime.previewEndsAt : 0;
  state.raceEndsAt = runtime.phase === "racing" ? runtime.raceEndsAt : 0;
  state.resultsEndsAt = runtime.phase === "round-result" ? runtime.resultsEndsAt : 0;
  state.raceElapsedMs =
    runtime.phase === "racing" || runtime.phase === "round-result" ? runtime.raceElapsedMs : 0;
  state.pathVisible = runtime.pathVisible;
  state.opponentsVisible = runtime.opponentsVisible;
  state.pathWidth = runtime.pathWidth;
  state.movementSpeed = runtime.phase === "lobby" ? 0 : runtime.settings.movementSpeed;
  state.startX = MEMORY_PATH_CONSTANTS.START_X;
  state.startY = MEMORY_PATH_CONSTANTS.START_Y;
  state.finishX = MEMORY_PATH_CONSTANTS.FINISH_X;
  state.finishY = MEMORY_PATH_CONSTANTS.FINISH_Y;
  state.finishRadius = MEMORY_PATH_CONSTANTS.FINISH_RADIUS;
  state.startRadius = MEMORY_PATH_CONSTANTS.START_RADIUS;

  if (roundChanged || state.routePoints.length === 0) {
    state.routePoints.clear();
    for (const point of runtime.route.points) {
      const pointState = new MemoryPathPointState();
      pointState.x = point.x;
      pointState.y = point.y;
      state.routePoints.push(pointState);
    }
  }
  if (roundChanged || state.landmarks.length === 0) {
    state.landmarks.clear();
    for (const landmark of runtime.landmarks) {
      const landmarkState = new MemoryPathLandmarkState();
      landmarkState.id = landmark.id;
      landmarkState.shape = landmark.shape;
      landmarkState.x = landmark.x;
      landmarkState.y = landmark.y;
      landmarkState.size = landmark.size;
      landmarkState.color = landmark.color;
      state.landmarks.push(landmarkState);
    }
  }

  if (runtime.roundResult === null) {
    state.roundResult = null;
  } else if (state.roundResult === null) {
    state.roundResult = new MemoryPathRoundResultState();
    copyRoundResult(state.roundResult, runtime.roundResult);
  } else {
    copyRoundResult(state.roundResult, runtime.roundResult);
  }

  if (runtime.result === null) {
    state.matchResult = null;
  } else if (state.matchResult === null) {
    state.matchResult = new MemoryPathMatchResultState();
    copyMatchResult(state.matchResult, runtime.result);
  } else {
    copyMatchResult(state.matchResult, runtime.result);
  }

  for (const [sessionId, player] of runtime.players) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new MemoryPathPlayerState();
      state.players.set(sessionId, playerState);
    }
    copyPlayer(playerState, player);
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.players.has(key)) {
      state.players.delete(key);
    }
  }
}
