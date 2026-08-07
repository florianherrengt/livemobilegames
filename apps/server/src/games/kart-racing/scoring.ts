import type { KartRacingMatchResult, KartRacingRuntime, MatchLeaderboardEntry } from "./types.js";

interface ScoringEntry {
  sessionId: string;
  label: string;
  matchPoints: number;
  raceWins: number;
  secondPlaces: number;
  thirdPlaces: number;
  finalRacePosition: number;
  /** Infinity when the player never completed a race. */
  effectiveTotalTimeMs: number;
}

function finalRacePosition(runtime: KartRacingRuntime, sessionId: string): number {
  const player = runtime.players.get(sessionId);
  if (player === undefined || player.removed || player.lastRacePosition === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return player.lastRacePosition;
}

function effectiveTotalTimeMs(player: { totalRaceTimeMs: number }): number {
  // A zero total means the player never finished a race. Treating it as the
  // lowest time would let a non-finisher win a tie, so missing times rank
  // worst, exactly as the task's "across completed races" tie-breaker intends.
  return player.totalRaceTimeMs === 0 ? Number.POSITIVE_INFINITY : player.totalRaceTimeMs;
}

function identicalFullTie(a: ScoringEntry, b: ScoringEntry): boolean {
  return (
    a.matchPoints === b.matchPoints &&
    a.raceWins === b.raceWins &&
    a.secondPlaces === b.secondPlaces &&
    a.thirdPlaces === b.thirdPlaces &&
    a.finalRacePosition === b.finalRacePosition &&
    a.effectiveTotalTimeMs === b.effectiveTotalTimeMs
  );
}

/**
 * Build the final match result after all three races.
 *
 * Ranking uses the task's tie-breaker order: most match points, most race
 * wins, most second-place finishes, most third-place finishes, best final-race
 * position, then lowest total combined finish time. Entries that remain
 * identical on every key share a placement.
 */
export function buildKartRacingResult(runtime: KartRacingRuntime): KartRacingMatchResult {
  const sorted: ScoringEntry[] = [...runtime.players.values()]
    .map((player) => ({
      sessionId: player.sessionId,
      label: player.name,
      matchPoints: player.matchPoints,
      raceWins: player.raceWins,
      secondPlaces: player.secondPlaces,
      thirdPlaces: player.thirdPlaces,
      finalRacePosition: finalRacePosition(runtime, player.sessionId),
      effectiveTotalTimeMs: effectiveTotalTimeMs(player),
    }))
    .sort(
      (a, b) =>
        b.matchPoints - a.matchPoints ||
        b.raceWins - a.raceWins ||
        b.secondPlaces - a.secondPlaces ||
        b.thirdPlaces - a.thirdPlaces ||
        a.finalRacePosition - b.finalRacePosition ||
        a.effectiveTotalTimeMs - b.effectiveTotalTimeMs ||
        a.label.localeCompare(b.label, "en"),
    );

  const leaderboard: MatchLeaderboardEntry[] = [];
  for (const [index, entry] of sorted.entries()) {
    const previous = sorted[index - 1];
    const rank =
      previous !== undefined && identicalFullTie(previous, entry)
        ? (leaderboard[index - 1]?.rank ?? index + 1)
        : index + 1;
    leaderboard.push({
      sessionId: entry.sessionId,
      label: entry.label,
      rank,
      matchPoints: entry.matchPoints,
      raceWins: entry.raceWins,
      totalRaceTimeMs: Number.isFinite(entry.effectiveTotalTimeMs) ? entry.effectiveTotalTimeMs : 0,
    });
  }

  const first = sorted[0];
  return {
    winnerSessionIds: sorted
      .filter((entry) => first !== undefined && identicalFullTie(first, entry))
      .map((entry) => entry.sessionId),
    leaderboard,
  };
}
