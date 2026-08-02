import { FlappyRacePlayerState, type FlappyRaceState } from "./state.js";
import type { FlappyRaceRuntime } from "./types.js";

function resetPlayerProjection(target: FlappyRacePlayerState): void {
  target.color = "";
  target.roundWins = 0;
  target.clearedObstacleCount = 0;
  target.roundActive = false;
  target.eliminated = false;
  target.matchRemoved = false;
  target.birdY = 0;
  target.birdVy = 0;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes Flappy Race game fields; the platform owns the player
 * rows, so rows are never deleted here.
 */
export function syncState(state: FlappyRaceState, runtime: FlappyRaceRuntime): void {
  state.phase = runtime.phase;
  state.roundNumber = runtime.roundNumber;
  state.totalRounds = runtime.totalRounds;
  state.countdownEndsAt = runtime.phase === "countdown" ? runtime.countdownEndsAt : 0;
  state.roundStartedAt = runtime.phase === "running" ? runtime.roundStartedAt : 0;
  state.courseElapsedMs =
    runtime.phase === "countdown" ||
    runtime.phase === "running" ||
    runtime.phase === "round-result" ||
    runtime.phase === "finished"
      ? runtime.courseElapsedMs
      : 0;
  state.resultsEndsAt = runtime.phase === "round-result" ? runtime.resultsEndsAt : 0;
  state.courseSeed = runtime.courseSeed;
  state.courseSpeed = runtime.phase === "lobby" ? 0 : runtime.settings.courseSpeed;

  state.obstacleOpenings.clear();
  for (const opening of runtime.openings) {
    state.obstacleOpenings.push(opening);
  }
  state.roundWinnerSessionIds.clear();
  for (const sessionId of runtime.roundWinnerSessionIds) {
    state.roundWinnerSessionIds.push(sessionId);
  }

  if (runtime.phase === "lobby") {
    for (const player of state.players.values()) {
      resetPlayerProjection(player);
    }
    return;
  }

  for (const [sessionId, player] of runtime.players) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new FlappyRacePlayerState();
      state.players.set(sessionId, playerState);
    }
    playerState.name = player.name;
    playerState.color = player.color;
    playerState.roundWins = player.roundWins;
    playerState.clearedObstacleCount = player.clearedObstacleCount;
    playerState.roundActive = player.roundActive;
    playerState.eliminated = player.eliminated;
    playerState.matchRemoved = !player.eligible;
    playerState.birdY = player.birdY;
    playerState.birdVy = player.birdVy;
    playerState.joinedOrder = player.joinedOrder;
  }
}
