import {
  GolfRaceLeaderboardEntryState,
  GolfRacePlayerState,
  GolfRaceResultState,
  type GolfRaceState,
} from "@phone-party/protocol";

import type { GolfRuntime, RuntimePlayer } from "./types.js";

function copyPlayer(target: GolfRacePlayerState, source: RuntimePlayer, now: number): void {
  target.name = source.name;
  target.joinedOrder = source.joinedOrder;
  target.color = source.color;
  target.connectionStatus = source.connected
    ? "connected"
    : source.removed
      ? "disconnected"
      : "reconnecting";
  target.positionX = source.x;
  target.positionY = source.y;
  target.velocityX = source.vx;
  target.velocityY = source.vy;
  target.moving = source.moving;
  target.latestGateIndex = source.latestGateIndex;
  target.raceProgress = source.raceProgress;
  target.sectionProgress = source.sectionProgress;
  target.finished = source.finished;
  target.finishedRank = source.finishedRank;
  target.timedOut = source.timedOut;
  target.roundWins = source.roundWins;
  target.matchPoints = source.matchPoints;
  target.playedThisRound = source.playedThisRound;
  target.collisionImmune = source.collisionImmunityUntil > now || source.protectedNextTurn;
  target.immunityUntil = source.collisionImmunityUntil;
}

function toResultState(result: NonNullable<GolfRuntime["result"]>): GolfRaceResultState {
  const state = new GolfRaceResultState();
  for (const sessionId of result.winnerSessionIds) {
    state.winnerSessionIds.push(sessionId);
  }
  for (const entry of result.leaderboard) {
    const leaderboardEntry = new GolfRaceLeaderboardEntryState();
    leaderboardEntry.sessionId = entry.sessionId;
    leaderboardEntry.rank = entry.rank;
    leaderboardEntry.finishOrder = entry.finishOrder;
    leaderboardEntry.primaryScore = entry.primaryScore;
    leaderboardEntry.roundWins = entry.roundWins;
    leaderboardEntry.label = entry.label;
    state.leaderboard.push(leaderboardEntry);
  }
  return state;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes client-facing Golf state, and it never exposes the
 * shot sequence windows, physics accumulators, turn bookkeeping, respawn
 * deadlines, or the course's validated internals.
 */
export function syncGolfRaceState(state: GolfRaceState, runtime: GolfRuntime): void {
  const now = Date.now();
  state.phase = runtime.phase;
  state.roundNumber = runtime.roundNumber;
  state.totalRounds = runtime.totalRounds;
  state.countdownEndsAt = runtime.phase === "countdown" ? runtime.countdownEndsAt : 0;
  state.aimingEndsAt = runtime.phase === "aiming" ? runtime.aimingEndsAt : 0;
  state.roundEndsAt =
    runtime.phase === "aiming" || runtime.phase === "simulating" ? runtime.roundEndsAt : 0;
  state.resultsEndsAt = runtime.phase === "round-result" ? runtime.resultsEndsAt : 0;
  state.currentTurnSessionId = runtime.phase === "aiming" ? runtime.currentTurnSessionId : "";
  state.turnIndex = runtime.turnIndex;

  state.turnOrder.clear();
  for (const sessionId of runtime.turnOrder) {
    state.turnOrder.push(sessionId);
  }

  let finishedCount = 0;
  for (const [sessionId, player] of runtime.players) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new GolfRacePlayerState();
      state.players.set(sessionId, playerState);
    }
    copyPlayer(playerState, player, now);
    if (player.finished) {
      finishedCount += 1;
    }
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.players.has(key)) {
      state.players.delete(key);
    }
  }
  state.finishedCount = finishedCount;

  state.roundWinnerSessionIds.clear();
  for (const sessionId of runtime.roundWinnerSessionIds) {
    state.roundWinnerSessionIds.push(sessionId);
  }

  if (runtime.result === null) {
    state.result = null;
  } else if (state.result === null) {
    state.result = toResultState(runtime.result);
  }
}
