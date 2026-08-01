import { ArraySchema, Schema, type } from "@colyseus/schema";

import type { ConnectionStatus, RoomStatus } from "@falling-platforms/platform-shared";

export class PlatformPlayerState extends Schema {
  @type("string") name = "";
  @type("string") connectionStatus: ConnectionStatus = "connected";
  @type("boolean") isHost = false;
  @type("boolean") isReady = false;
  @type("number") joinedAt = 0;
  @type("number") joinedOrder = 0;
}

export class LeaderboardEntryState extends Schema {
  @type("string") sessionId = "";
  @type("number") rank = 0;
  @type("number") primaryScore = 0;
  @type("string") label = "";
  @type("string") secondaryLabel = "";
}

export class MatchResultState extends Schema {
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([LeaderboardEntryState]) leaderboard = new ArraySchema<LeaderboardEntryState>();
  @type("number") finishedAt = 0;
}

/**
 * Platform-owned synchronized state. Games extend this class and must declare
 * their own `players` map typed with their game-specific player schema.
 */
export class PlatformState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") status: RoomStatus = "lobby";
  @type("string") hostSessionId = "";
  @type("number") createdAt = 0;
  @type("number") minPlayers = 2;
  @type("boolean") requiresReady = true;
  @type(MatchResultState) result: MatchResultState | null = null;
}

export function matchResultToState(result: {
  winnerSessionIds: readonly string[];
  leaderboard: ReadonlyArray<{
    sessionId: string;
    rank: number;
    primaryScore: number;
    label: string;
    secondaryLabel?: string | undefined;
  }>;
  finishedAt: number;
}): MatchResultState {
  const state = new MatchResultState();
  state.finishedAt = result.finishedAt;
  for (const sessionId of result.winnerSessionIds) {
    state.winnerSessionIds.push(sessionId);
  }
  for (const entry of result.leaderboard) {
    const entryState = new LeaderboardEntryState();
    entryState.sessionId = entry.sessionId;
    entryState.rank = entry.rank;
    entryState.primaryScore = entry.primaryScore;
    entryState.label = entry.label;
    entryState.secondaryLabel = entry.secondaryLabel ?? "";
    state.leaderboard.push(entryState);
  }
  return state;
}

export function stateToMatchResult(state: MatchResultState | null): {
  winnerSessionIds: string[];
  leaderboard: Array<{
    sessionId: string;
    rank: number;
    primaryScore: number;
    label: string;
    secondaryLabel?: string | undefined;
  }>;
  finishedAt: number;
} | null {
  if (!state) {
    return null;
  }
  return {
    winnerSessionIds: [...state.winnerSessionIds],
    leaderboard: [...state.leaderboard].map((entry) => ({
      sessionId: entry.sessionId,
      rank: entry.rank,
      primaryScore: entry.primaryScore,
      label: entry.label,
      ...(entry.secondaryLabel ? { secondaryLabel: entry.secondaryLabel } : {}),
    })),
    finishedAt: state.finishedAt,
  };
}
