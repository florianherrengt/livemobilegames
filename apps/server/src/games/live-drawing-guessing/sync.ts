import {
  type LiveDrawingGuessingState,
  LiveDrawingLeaderboardEntryState,
  LiveDrawingPlayerState,
  LiveDrawingResultState,
  LiveDrawingTurnResultState,
} from "@phone-party/protocol";
import type { LiveDrawingRuntime, RuntimePlayer } from "./engine.js";

function copyPlayer(target: LiveDrawingPlayerState, source: RuntimePlayer): void {
  target.playerId = source.playerId;
  target.sessionId = source.sessionId;
  target.name = source.name;
  target.isHost = source.isHost;
  target.connectionStatus = source.connected
    ? "connected"
    : source.reconnecting
      ? "reconnecting"
      : "disconnected";
  target.joinedOrder = source.joinedOrder;
  target.score = source.score;
  target.isSpectator = source.isSpectator;
}

function toTurnResultState(
  result: NonNullable<LiveDrawingRuntime["lastResult"]>,
): LiveDrawingTurnResultState {
  const state = new LiveDrawingTurnResultState();
  state.word = result.word;
  state.category = result.category;
  state.outcome = result.outcome;
  state.drawerPlayerId = result.drawerPlayerId;
  state.winnerPlayerId = result.winnerPlayerId;
  return state;
}

function toResultState(result: NonNullable<LiveDrawingRuntime["result"]>): LiveDrawingResultState {
  const state = new LiveDrawingResultState();
  for (const playerId of result.winnerPlayerIds) {
    state.winnerPlayerIds.push(playerId);
  }
  for (const entry of result.leaderboard) {
    const leaderboardEntry = new LiveDrawingLeaderboardEntryState();
    leaderboardEntry.playerId = entry.playerId;
    leaderboardEntry.rank = entry.rank;
    leaderboardEntry.score = entry.score;
    leaderboardEntry.label = entry.label;
    state.leaderboard.push(leaderboardEntry);
  }
  return state;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes client-facing Live Drawing and Guessing state, and
 * it never exposes the current word, reveal order, word deck, or hold state.
 * Synchronized strokes are owned by the room and only cleared here when a new
 * turn replaces the drawing.
 */
export function syncLiveDrawingGuessingState(
  state: LiveDrawingGuessingState,
  runtime: LiveDrawingRuntime,
): void {
  const turnChanged = state.turnNumber !== runtime.turnNumber;
  state.phase = runtime.phase;
  state.roundNumber = runtime.roundNumber;
  state.totalRounds = runtime.totalRounds;
  state.turnNumber = runtime.turnNumber;
  state.totalTurns = runtime.totalTurns;
  state.drawerPlayerId = runtime.drawerPlayerId;
  state.wordCategory =
    runtime.phase === "drawing" || runtime.phase === "result" ? runtime.category : "";
  state.prepareEndsAt = runtime.phase === "preparing" ? runtime.prepareEndsAt : 0;
  state.drawingEndsAt = runtime.phase === "drawing" ? runtime.drawingEndsAt : 0;
  state.resultEndsAt = runtime.phase === "result" ? runtime.resultEndsAt : 0;
  state.roundSummaryEndsAt = runtime.phase === "round-summary" ? runtime.roundSummaryEndsAt : 0;

  if (turnChanged) {
    state.strokes.clear();
  }
  if (runtime.phase === "drawing" || runtime.phase === "result") {
    state.letterPattern.clear();
    for (const char of runtime.pattern) {
      state.letterPattern.push(char);
    }
  } else {
    state.letterPattern.clear();
  }

  for (const [playerId, player] of runtime.players) {
    let playerState = state.players.get(playerId);
    if (!playerState) {
      playerState = new LiveDrawingPlayerState();
      state.players.set(playerId, playerState);
    }
    copyPlayer(playerState, player);
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.players.has(key)) {
      state.players.delete(key);
    }
  }

  if (runtime.lastResult === null) {
    state.lastResult = null;
  } else if (state.lastResult === null) {
    state.lastResult = toTurnResultState(runtime.lastResult);
  } else {
    state.lastResult.word = runtime.lastResult.word;
    state.lastResult.category = runtime.lastResult.category;
    state.lastResult.outcome = runtime.lastResult.outcome;
    state.lastResult.drawerPlayerId = runtime.lastResult.drawerPlayerId;
    state.lastResult.winnerPlayerId = runtime.lastResult.winnerPlayerId;
  }

  if (runtime.result === null) {
    state.result = null;
  } else if (state.result === null) {
    state.result = toResultState(runtime.result);
  }
}
