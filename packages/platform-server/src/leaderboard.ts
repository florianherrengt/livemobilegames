import type {
  LeaderboardEntry,
  MatchResult,
  ProtocolError,
} from "@falling-platforms/platform-shared";
import { matchResultSchema, protocolError } from "@falling-platforms/platform-shared";

export interface LeaderboardInput {
  sessionId: string;
  primaryScore: number;
  label: string;
  secondaryLabel?: string;
}

/** Standard competition ranking: equal scores share a rank and the next rank is skipped. */
export function buildLeaderboard(
  input: readonly LeaderboardInput[],
  finishedAt: number,
): MatchResult {
  const sorted = [...input].sort(
    (a, b) => b.primaryScore - a.primaryScore || a.sessionId.localeCompare(b.sessionId),
  );
  const leaderboard: LeaderboardEntry[] = [];
  let currentRank = 0;
  for (let index = 0; index < sorted.length; index++) {
    const item = sorted[index];
    if (!item) {
      continue;
    }
    if (index === 0 || item.primaryScore !== sorted[index - 1]?.primaryScore) {
      currentRank = index + 1;
    }
    const entry: LeaderboardEntry = {
      sessionId: item.sessionId,
      rank: currentRank,
      primaryScore: item.primaryScore,
      label: item.label,
      ...(item.secondaryLabel ? { secondaryLabel: item.secondaryLabel } : {}),
    };
    leaderboard.push(entry);
  }
  return {
    winnerSessionIds: leaderboard
      .filter((entry) => entry.rank === 1)
      .map((entry) => entry.sessionId),
    leaderboard,
    finishedAt,
  };
}

export function validateMatchResult(
  result: MatchResult,
  roomSessionIds: ReadonlySet<string>,
): ProtocolError | null {
  const parsed = matchResultSchema.safeParse(result);
  if (!parsed.success) {
    return protocolError("INVALID_REQUEST", "Invalid match result", {
      issues: parsed.error.issues,
    });
  }
  const valid = parsed.data;
  const leaderboardIds = new Set(valid.leaderboard.map((entry) => entry.sessionId));
  for (const entry of valid.leaderboard) {
    if (!roomSessionIds.has(entry.sessionId)) {
      return protocolError(
        "INVALID_REQUEST",
        "Leaderboard references a player who is not in the room",
        { sessionId: entry.sessionId },
      );
    }
  }
  for (const sessionId of valid.winnerSessionIds) {
    if (!leaderboardIds.has(sessionId)) {
      return protocolError("INVALID_REQUEST", "Winner is not present on the leaderboard", {
        sessionId,
      });
    }
  }
  return null;
}
