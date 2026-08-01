import { ArraySchema } from "@colyseus/schema";
import type { CapitalPinRuntime } from "./runtime.js";
import {
  CapitalPinPlayerState,
  type CapitalPinState,
  GuessResultState,
  RoundResultState,
} from "./state.js";
import type { Score } from "./types.js";

function copyPlayer(target: CapitalPinPlayerState, source: Score, submitted: boolean): void {
  target.roundWins = source.roundWins;
  target.totalDistanceKm = source.totalDistanceKm;
  target.submitted = submitted;
}

function toRoundResultState(
  runtime: CapitalPinRuntime,
  displayNameOf: (sessionId: string) => string,
): RoundResultState | null {
  const result = runtime.lastResult;
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
    if (!standing.validGuess) continue;
    const guess = new GuessResultState();
    guess.sessionId = standing.sessionId;
    guess.displayName = displayNameOf(standing.sessionId);
    guess.latitude = standing.latitude ?? 0;
    guess.longitude = standing.longitude ?? 0;
    guess.distanceKm = standing.distanceKm;
    guess.isWinner = standing.isWinner;
    state.guesses.push(guess);
  }
  return state;
}

/**
 * Project the server-only runtime onto the synchronized schema.
 *
 * This is the ONLY place that writes client-facing game state, and it never
 * exposes the active round's coordinates, country, or any guess — only the
 * capital name and who has locked. The full result is revealed through
 * `lastResult` once the round has ended.
 */
export function syncState(
  state: CapitalPinState,
  runtime: CapitalPinRuntime,
  displayNameOf: (sessionId: string) => string,
  connectedSessionIds: ReadonlySet<string>,
): void {
  state.phase = runtime.phase;
  state.roundNumber = runtime.currentRound?.roundNumber ?? runtime.lastResult?.roundNumber ?? 0;
  state.totalRounds = runtime.totalRounds;
  state.currentCapitalName =
    runtime.phase === "round" && runtime.currentRound ? runtime.currentRound.capital.city : "";
  state.roundEndsAt =
    runtime.currentRound && !runtime.currentRound.finished ? runtime.currentRound.endsAt : 0;
  state.resultsEndsAt = runtime.phase === "round-results" ? (runtime.currentRound?.endsAt ?? 0) : 0;

  // lastResult: only present once a round has finished.
  const projected = toRoundResultState(runtime, displayNameOf);
  state.lastResult = projected;

  // Players: keep the participant set, project scores + submitted flags.
  for (const sessionId of runtime.participantIds) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new CapitalPinPlayerState();
      state.players.set(sessionId, playerState);
    }
    const score = runtime.scores.get(sessionId);
    copyPlayer(
      playerState,
      score ?? { roundWins: 0, totalDistanceKm: 0, validGuessCount: 0, missedRoundCount: 0 },
      runtime.currentRound?.guesses.has(sessionId) ?? false,
    );
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.participantIds.includes(key)) {
      state.players.delete(key);
    }
  }
  // connectedSessionIds is consumed implicitly: the platform owns connection
  // status on PlatformPlayerState; we only project game fields here.
  void connectedSessionIds;
}

/** Convenience: clear the game projection back to the lobby. */
export function clearGameProjection(state: CapitalPinState): void {
  state.phase = "lobby";
  state.roundNumber = 0;
  state.totalRounds = 0;
  state.roundEndsAt = 0;
  state.resultsEndsAt = 0;
  state.currentCapitalName = "";
  state.lastResult = null;
  for (const player of state.players.values()) {
    player.roundWins = 0;
    player.totalDistanceKm = 0;
    player.submitted = false;
  }
}

// Re-export schema constructors used by the server module so it has a single
// import surface for projection helpers.
export { ArraySchema };
