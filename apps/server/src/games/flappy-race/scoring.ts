import type {
  FlappyRaceLeaderboardEntry,
  FlappyRaceMatchResult,
  FlappyRaceRuntime,
} from "./types.js";

/**
 * Build the final match result. Ranking is standard competition ranking by
 * round wins, with display name breaking presentation order. Every player with
 * the maximum round-win count is a joint winner.
 */
export function buildFlappyRaceResult(runtime: FlappyRaceRuntime): FlappyRaceMatchResult {
  const entries = [...runtime.players.values()]
    .map((player) => ({
      sessionId: player.sessionId,
      primaryScore: player.roundWins,
      label: player.name,
    }))
    .sort((a, b) => b.primaryScore - a.primaryScore || a.label.localeCompare(b.label, "en"));

  const leaderboard: FlappyRaceLeaderboardEntry[] = entries.reduce((acc, entry, index) => {
    const previous = acc[acc.length - 1];
    const rank =
      previous !== undefined && previous.primaryScore === entry.primaryScore
        ? previous.rank
        : index + 1;
    acc.push({
      sessionId: entry.sessionId,
      rank,
      primaryScore: entry.primaryScore,
      label: entry.label,
    });
    return acc;
  }, [] as FlappyRaceLeaderboardEntry[]);

  const maxScore = leaderboard[0]?.primaryScore ?? 0;
  return {
    winnerSessionIds: leaderboard
      .filter((entry) => entry.primaryScore === maxScore)
      .map((entry) => entry.sessionId),
    leaderboard,
  };
}
