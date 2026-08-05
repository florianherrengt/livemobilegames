import { CAPITAL_PIN_CONSTANTS } from "./constants.js";
import { type Coordinates, haversineDistanceKm } from "./distance.js";
import type { Capital, Guess, RoundResult, RoundStanding, Score } from "./types.js";

/**
 * Compute the standings for a single round given the round's correct capital,
 * the full participant list, and every participant's submitted guess (which
 * may be absent). Missing participants receive the penalty distance.
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
        displayName: "",
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
      displayName: "",
      latitude: guess.latitude,
      longitude: guess.longitude,
      distanceKm,
      validGuess: true,
      isWinner: false,
    };
  });

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
  displayNameOf: (sessionId: string) => string,
): RoundResult {
  const { standings, winnerSessionIds } = computeRoundStandings(capital, participantIds, guesses);
  for (const standing of standings) {
    standing.displayName = displayNameOf(standing.sessionId);
  }
  return {
    roundNumber,
    capital,
    winnerSessionIds,
    standings,
  };
}

/** Apply a round result to the scoreboard. Mutates the score objects in place. */
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
 * Determine final winner session ids: highest round-win count first, then
 * lowest total distance; sessions within one metre (epsilon) of that lowest
 * distance are joint winners. Stable alphabetical display-name ordering is
 * applied for presentation.
 */
export function computeFinalWinners(
  participantIds: readonly string[],
  scores: ReadonlyMap<string, Score>,
  displayNameOf: (sessionId: string) => string,
): string[] {
  if (participantIds.length === 0) {
    return [];
  }

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

  return winners
    .map((w) => ({ ...w, name: displayNameOf(w.sessionId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((w) => w.sessionId);
}

export interface LeaderboardEntry {
  sessionId: string;
  rank: number;
  primaryScore: number;
  label: string;
}

/**
 * Build the final match result. Ranking is standard competition ranking by
 * round wins, with lower total distance and then display name breaking the
 * presentation order. Winners follow the round-win/distance epsilon rule.
 */
export function buildMatchResult(
  participantIds: readonly string[],
  scores: ReadonlyMap<string, Score>,
  displayNameOf: (sessionId: string) => string,
  finishedAt: number,
): { winnerSessionIds: string[]; leaderboard: LeaderboardEntry[]; finishedAt: number } {
  const entries = participantIds
    .map((sessionId) => {
      const score = scores.get(sessionId) ?? {
        roundWins: 0,
        totalDistanceKm: 0,
        validGuessCount: 0,
        missedRoundCount: 0,
      };
      return {
        sessionId,
        primaryScore: score.roundWins,
        totalDistanceKm: score.totalDistanceKm,
        label: displayNameOf(sessionId),
      };
    })
    .sort(
      (a, b) =>
        b.primaryScore - a.primaryScore ||
        a.totalDistanceKm - b.totalDistanceKm ||
        a.label.localeCompare(b.label, "en"),
    );

  const final = entries.reduce(
    (acc, entry, index) => {
      const rank =
        acc.previousScore !== null && entry.primaryScore === acc.previousScore
          ? acc.previousRank
          : index + 1;
      return {
        leaderboard: [
          ...acc.leaderboard,
          {
            sessionId: entry.sessionId,
            rank,
            primaryScore: entry.primaryScore,
            label: entry.label,
          },
        ],
        previousScore: entry.primaryScore,
        previousRank: rank,
      };
    },
    {
      leaderboard: [] as LeaderboardEntry[],
      previousScore: null as number | null,
      previousRank: 0,
    },
  );

  return {
    winnerSessionIds: computeFinalWinners(participantIds, scores, displayNameOf),
    leaderboard: final.leaderboard,
    finishedAt,
  };
}
