import { CAPITAL_PIN_CONSTANTS } from "./constants.js";
import { type Coordinates, haversineDistanceKm } from "./distance.js";
import type { Capital, Guess, RoundResult, RoundStanding, Score } from "./types.js";

/**
 * Compute the standings for a single round given the round's correct capital,
 * the full participant list, and every participant's submitted guess (which may
 * be absent).
 *
 * Returns:
 * - standings: one entry per participant, including penalties for missing players
 * - winnerSessionIds: closest players within the tie epsilon (empty if no valid guess)
 */
export function computeRoundStandings(
  capital: Capital,
  participantIds: readonly string[],
  guesses: ReadonlyMap<string, Guess>,
): { standings: RoundStanding[]; winnerSessionIds: string[] } {
  const target: Coordinates = { latitude: capital.latitude, longitude: capital.longitude };

  const standings: RoundStanding[] = participantIds.map((sessionId) => {
    const guess = guesses.get(sessionId);
    if (!guess) {
      return {
        sessionId,
        latitude: null,
        longitude: null,
        distanceKm: CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM,
        validGuess: false,
        isWinner: false,
      };
    }
    const distanceKm = haversineDistanceKm(target, {
      latitude: guess.latitude,
      longitude: guess.longitude,
    });
    return {
      sessionId,
      latitude: guess.latitude,
      longitude: guess.longitude,
      distanceKm,
      validGuess: true,
      isWinner: false,
    };
  });

  // Find the minimum distance among valid guesses only.
  const validDistances = standings.filter((s) => s.validGuess).map((s) => s.distanceKm);
  const minDistance = validDistances.length > 0 ? Math.min(...validDistances) : null;

  const winnerSessionIds: string[] = [];
  if (minDistance !== null) {
    for (const standing of standings) {
      if (
        standing.validGuess &&
        standing.distanceKm - minDistance <= CAPITAL_PIN_CONSTANTS.DISTANCE_TIE_EPSILON_KM
      ) {
        standing.isWinner = true;
        winnerSessionIds.push(standing.sessionId);
      }
    }
  }

  return { standings, winnerSessionIds };
}

/**
 * Build a RoundResult from a finished round, considering every participant
 * (missing participants get the penalty distance).
 */
export function buildRoundResult(
  participantIds: readonly string[],
  capital: Capital,
  roundNumber: number,
  guesses: ReadonlyMap<string, Guess>,
): RoundResult {
  const { standings, winnerSessionIds } = computeRoundStandings(capital, participantIds, guesses);
  return {
    roundNumber,
    capital,
    winnerSessionIds,
    standings,
  };
}

/**
 * Apply a round result to the scoreboard.
 * Assumes the result already contains a standing for every participant
 * (with the missing-guess penalty where applicable).
 */
export function applyRoundResultToScores(
  scores: ReadonlyMap<string, Score>,
  result: RoundResult,
): void {
  const standingsBySession = new Map<string, RoundStanding>(
    result.standings.map((s) => [s.sessionId, s]),
  );

  for (const [sessionId, score] of scores) {
    const standing = standingsBySession.get(sessionId);
    if (!standing) {
      // Defensive: participant missing from result — treat as missing guess.
      score.totalDistanceKm += CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM;
      score.missedRoundCount += 1;
      continue;
    }

    if (standing.validGuess) {
      score.totalDistanceKm += standing.distanceKm;
      score.validGuessCount += 1;
    } else {
      score.totalDistanceKm += CAPITAL_PIN_CONSTANTS.MISSING_GUESS_DISTANCE_KM;
      score.missedRoundCount += 1;
    }

    if (standing.isWinner) {
      score.roundWins += 1;
    }
  }
}

/**
 * Determine final winner session ids.
 * 1. Highest round-win count.
 * 2. Among those, lowest total distance.
 * 3. Sessions within one metre (epsilon) of that lowest distance are joint winners.
 *
 * `displayNameOf` provides stable alphabetical ordering for ties.
 */
export function computeFinalWinners(
  participantIds: readonly string[],
  scores: ReadonlyMap<string, Score>,
  displayNameOf: (sessionId: string) => string,
): string[] {
  if (participantIds.length === 0) return [];

  const scored = participantIds.map((sessionId) => ({
    sessionId,
    ...(scores.get(sessionId) ?? {
      roundWins: 0,
      totalDistanceKm: 0,
      validGuessCount: 0,
      missedRoundCount: 0,
    }),
  }));

  const maxWins = Math.max(...scored.map((s) => s.roundWins));
  const topByWins = scored.filter((s) => s.roundWins === maxWins);

  const minDistance = Math.min(...topByWins.map((s) => s.totalDistanceKm));
  const winners = topByWins.filter(
    (s) => s.totalDistanceKm - minDistance <= CAPITAL_PIN_CONSTANTS.DISTANCE_TIE_EPSILON_KM,
  );

  // Stable alphabetical display-name ordering for presentation.
  return winners
    .map((w) => ({ ...w, name: displayNameOf(w.sessionId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((w) => w.sessionId);
}
