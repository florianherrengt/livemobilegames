import type { MemoryPathRuntime, RuntimePlayer } from "./types.js";

const PROGRESS_EPSILON = 1e-9;
const TIME_EPSILON_MS = 1;

export interface TimeoutCandidate {
  sessionId: string;
  connected: boolean;
  participating: boolean;
  maxProgress: number;
  maxProgressFirstReachedAt: number;
  falls: number;
  joinedOrder: number;
}

/**
 * Authoritative timeout ordering:
 * 1. highest maximum valid path progress;
 * 2. earliest time that maximum progress was first reached;
 * 3. fewest falls;
 * 4. stable joined order.
 * Sudden-death rounds use the same ordering, so a timeout always yields one
 * winner even when the field is tied.
 */
export function compareTimeoutCandidates(a: TimeoutCandidate, b: TimeoutCandidate): number {
  if (Math.abs(b.maxProgress - a.maxProgress) > PROGRESS_EPSILON) {
    return b.maxProgress - a.maxProgress;
  }
  if (Math.abs(a.maxProgressFirstReachedAt - b.maxProgressFirstReachedAt) > TIME_EPSILON_MS) {
    return a.maxProgressFirstReachedAt - b.maxProgressFirstReachedAt;
  }
  if (a.falls !== b.falls) {
    return a.falls - b.falls;
  }
  return a.joinedOrder - b.joinedOrder;
}

export function timeoutCandidateOf(player: RuntimePlayer): TimeoutCandidate {
  return {
    sessionId: player.sessionId,
    connected: player.connected,
    participating: player.participating,
    maxProgress: player.maxProgress,
    maxProgressFirstReachedAt: player.maxProgressFirstReachedAt,
    falls: player.falls,
    joinedOrder: player.joinedOrder,
  };
}

export function resolveTimeoutWinner(players: readonly RuntimePlayer[]): string | null {
  const candidates = players
    .filter((player) => player.connected && player.participating)
    .map(timeoutCandidateOf);
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort(compareTimeoutCandidates)[0]?.sessionId ?? null;
}

export function matchLeaders(runtime: MemoryPathRuntime): RuntimePlayer[] {
  const participants = [...runtime.players.values()].filter((player) => player.connected);
  const maxWins = Math.max(0, ...participants.map((player) => player.roundWins));
  return participants
    .filter((player) => player.roundWins === maxWins)
    .sort((a, b) => a.joinedOrder - b.joinedOrder);
}

/**
 * Every leader by round wins, including players in the reconnection grace
 * window. Sudden-death participants are decided from this set so a tied leader
 * who briefly dropped during the previous round can rejoin and race.
 */
export function allMatchLeaders(runtime: MemoryPathRuntime): RuntimePlayer[] {
  const players = [...runtime.players.values()];
  const maxWins = Math.max(0, ...players.map((player) => player.roundWins));
  return players
    .filter((player) => player.roundWins === maxWins)
    .sort((a, b) => a.joinedOrder - b.joinedOrder);
}

export function buildMatchResult(runtime: MemoryPathRuntime): MemoryPathRuntime["result"] {
  const entries = [...runtime.players.values()]
    .map((player) => ({
      sessionId: player.sessionId,
      roundWins: player.roundWins,
      label: player.name,
    }))
    .sort((a, b) => b.roundWins - a.roundWins || a.label.localeCompare(b.label, "en"));

  const leaderboard = entries.reduce(
    (acc, entry, index) => {
      const previous = acc[acc.length - 1];
      const rank =
        previous !== undefined && previous.roundWins === entry.roundWins
          ? previous.rank
          : index + 1;
      acc.push({ ...entry, rank });
      return acc;
    },
    [] as Array<{ sessionId: string; rank: number; roundWins: number; label: string }>,
  );

  const maxWins = leaderboard[0]?.roundWins ?? 0;
  return {
    winnerSessionIds: leaderboard
      .filter((entry) => entry.roundWins === maxWins)
      .map((entry) => entry.sessionId),
    leaderboard,
    roundResults: [...runtime.roundResults],
    suddenDeathUsed: runtime.suddenDeath,
  };
}
