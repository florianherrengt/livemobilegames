/** Server-only internal model shared by the engine, scoring and dataset. */

export interface Capital {
  id: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
}

/** A player's submitted guess for a round. */
export interface Guess {
  sessionId: string;
  latitude: number;
  longitude: number;
  submittedAt: number;
}

/** One participant's standing in a single round. */
export interface RoundStanding {
  sessionId: string;
  displayName: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number;
  validGuess: boolean;
  isWinner: boolean;
}

/** The computed result of a finished round. */
export interface RoundResult {
  roundNumber: number;
  capital: Capital;
  winnerSessionIds: string[];
  standings: RoundStanding[];
}

/** Per-player accumulated score across rounds. */
export interface Score {
  roundWins: number;
  totalDistanceKm: number;
  validGuessCount: number;
  missedRoundCount: number;
}

export function emptyScore(): Score {
  return {
    roundWins: 0,
    totalDistanceKm: 0,
    validGuessCount: 0,
    missedRoundCount: 0,
  };
}
