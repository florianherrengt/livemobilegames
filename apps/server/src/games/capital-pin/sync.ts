import {
  CapitalPinPlayerState,
  CapitalPinResultState,
  type CapitalPinState,
  GuessResultState,
  LeaderboardEntryState,
  RoundResultState,
} from "@phone-party/protocol";

import type { CapitalPinEngine } from "./engine.js";

function toRoundResultState(engine: CapitalPinEngine): RoundResultState | null {
  const result = engine.lastResult;
  if (!result) {
    return null;
  }
  const state = new RoundResultState();
  state.roundNumber = result.roundNumber;
  state.capitalName = result.capital.city;
  state.country = result.capital.country;
  state.correctLatitude = result.capital.latitude;
  state.correctLongitude = result.capital.longitude;
  for (const sessionId of result.winnerSessionIds) {
    state.winnerSessionIds.push(sessionId);
  }
  for (const standing of result.standings) {
    if (!standing.validGuess) {
      continue;
    }
    const guess = new GuessResultState();
    guess.sessionId = standing.sessionId;
    guess.displayName = standing.displayName;
    guess.latitude = standing.latitude ?? 0;
    guess.longitude = standing.longitude ?? 0;
    guess.distanceKm = standing.distanceKm;
    guess.isWinner = standing.isWinner;
    state.guesses.push(guess);
  }
  return state;
}

function toResultState(engine: CapitalPinEngine): CapitalPinResultState | null {
  const result = engine.result;
  if (!result) {
    return null;
  }
  const state = new CapitalPinResultState();
  state.finishedAt = result.finishedAt;
  for (const sessionId of result.winnerSessionIds) {
    state.winnerSessionIds.push(sessionId);
  }
  for (const entry of result.leaderboard) {
    const leaderboardEntry = new LeaderboardEntryState();
    leaderboardEntry.sessionId = entry.sessionId;
    leaderboardEntry.rank = entry.rank;
    leaderboardEntry.primaryScore = entry.primaryScore;
    leaderboardEntry.label = entry.label;
    state.leaderboard.push(leaderboardEntry);
  }
  return state;
}

/**
 * Project the server-only engine onto the synchronized schema. This is the
 * only place that writes client-facing game state, and it never exposes the
 * active round's coordinates, country, or any guess — only the capital name
 * and who has locked. The full result is revealed through `lastResult` once
 * the round has ended.
 */
export function syncCapitalPinState(state: CapitalPinState, engine: CapitalPinEngine): void {
  state.phase = engine.phase;
  state.roundNumber = engine.currentRound?.roundNumber ?? engine.lastResult?.roundNumber ?? 0;
  state.totalRounds = engine.totalRounds;
  state.currentCapitalName =
    engine.phase === "round" && engine.currentRound ? engine.currentRound.capital.city : "";
  state.roundEndsAt = engine.roundEndsAt;
  state.resultsEndsAt = engine.resultsEndsAt;
  state.lastResult = toRoundResultState(engine);
  state.result = toResultState(engine);

  for (const sessionId of engine.participantIds) {
    const playerState = state.players.get(sessionId) ?? addPlayer(state, sessionId);
    const score = engine.scores.get(sessionId);
    playerState.roundWins = score?.roundWins ?? 0;
    playerState.totalDistanceKm = score?.totalDistanceKm ?? 0;
    playerState.submitted = engine.currentRound?.guesses.has(sessionId) ?? false;
  }
  for (const key of [...state.players.keys()]) {
    if (!engine.participantIds.includes(key)) {
      state.players.delete(key);
    }
  }
}

function addPlayer(state: CapitalPinState, sessionId: string): CapitalPinPlayerState {
  const playerState = new CapitalPinPlayerState();
  state.players.set(sessionId, playerState);
  return playerState;
}

/** Convenience: clear the game projection back to the lobby. */
export function clearCapitalPinProjection(state: CapitalPinState): void {
  state.phase = "lobby";
  state.roundNumber = 0;
  state.totalRounds = 0;
  state.roundEndsAt = 0;
  state.resultsEndsAt = 0;
  state.currentCapitalName = "";
  state.lastResult = null;
  state.result = null;
  for (const player of state.players.values()) {
    player.roundWins = 0;
    player.totalDistanceKm = 0;
    player.submitted = false;
  }
}
