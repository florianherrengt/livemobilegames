import type { GameContext, GameDefinition } from "@falling-platforms/platform-server";
import { type CommandResult, protocolError } from "@falling-platforms/platform-shared";
import {
  type FallingPlatformsCommand,
  FallingPlatformsPlayerState,
  FallingPlatformsState,
  fallingPlatformsCommandSchema,
  HOP_MESSAGES_PER_SECOND,
  type MatchRuntime,
} from "@falling-platforms/shared";

import { startHop, validateHop } from "../game/hopping.js";
import {
  addPlayer,
  createRuntime,
  removePlayer,
  returnToLobby,
  startMatch,
  updateMatch,
} from "../game/match.js";
import { buildSettings } from "../game/settings.js";
import { copyPlayer, syncState } from "../game/sync.js";

export interface FallingPlatformsGameOptions {
  allowSolo: boolean;
  e2eMode: boolean;
  reconnectGraceMs: number;
}

const hopTimestamps = new WeakMap<FallingPlatformsState, Map<string, number[]>>();

function consumeHopRateLimit(
  state: FallingPlatformsState,
  sessionId: string,
  now: number,
): boolean {
  let timestamps = hopTimestamps.get(state);
  if (!timestamps) {
    timestamps = new Map();
    hopTimestamps.set(state, timestamps);
  }
  const recent = (timestamps.get(sessionId) ?? []).filter((timestamp) => timestamp >= now - 1000);
  if (recent.length >= HOP_MESSAGES_PER_SECOND) {
    timestamps.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  timestamps.set(sessionId, recent);
  return true;
}

function buildResult(
  runtime: MatchRuntime,
  finishedAt: number,
): {
  winnerSessionIds: string[];
  leaderboard: Array<{
    sessionId: string;
    rank: number;
    primaryScore: number;
    label: string;
  }>;
  finishedAt: number;
} {
  const leaderboard = [...runtime.players.values()]
    .map((player) => ({
      sessionId: player.sessionId,
      primaryScore: player.participating && player.alive ? 1 : 0,
      label: player.name,
    }))
    .sort((a, b) => b.primaryScore - a.primaryScore);
  let rank = 0;
  const entries = leaderboard.map((entry, index) => {
    if (index === 0 || entry.primaryScore !== leaderboard[index - 1]?.primaryScore) {
      rank = index + 1;
    }
    return { ...entry, rank };
  });
  return {
    winnerSessionIds: runtime.draw ? [] : [runtime.winnerSessionId].filter(Boolean),
    leaderboard: entries,
    finishedAt,
  };
}

export function createFallingPlatformsGame(
  options: FallingPlatformsGameOptions,
): GameDefinition<FallingPlatformsState, FallingPlatformsPlayerState, FallingPlatformsCommand> {
  const settings = buildSettings({ e2eMode: options.e2eMode, allowSolo: options.allowSolo });

  return {
    id: "falling_platforms",
    config: {
      minPlayers: options.allowSolo ? 1 : 2,
      maxPlayers: 100,
      reconnectGraceMs: options.reconnectGraceMs,
      allowJoinAfterStart: true,
      removeDisconnectedPlayers: true,
      requiresReady: false,
    },
    commandSchema: fallingPlatformsCommandSchema,

    createState(): FallingPlatformsState {
      const state = new FallingPlatformsState();
      state.runtime = createRuntime(settings);
      return state;
    },

    createPlayerState(): FallingPlatformsPlayerState {
      return new FallingPlatformsPlayerState();
    },

    onJoin(context: GameContext, state: FallingPlatformsState, sessionId: string): void {
      const runtime = state.runtime;
      if (!runtime) {
        return;
      }
      const player = context.getPlayer(sessionId);
      const runtimePlayer = addPlayer(
        runtime,
        sessionId,
        player?.name ?? "",
        player?.joinedOrder ?? 0,
      );
      const playerState = state.players.get(sessionId);
      if (playerState) {
        copyPlayer(playerState, runtimePlayer);
      }
    },

    onDrop(_context: GameContext, state: FallingPlatformsState, sessionId: string): void {
      const player = state.runtime?.players.get(sessionId);
      if (player) {
        player.connected = false;
      }
    },

    onReconnect(_context: GameContext, state: FallingPlatformsState, sessionId: string): void {
      const player = state.runtime?.players.get(sessionId);
      if (player) {
        player.connected = true;
      }
    },

    onRemoved(context: GameContext, state: FallingPlatformsState, sessionId: string): void {
      const runtime = state.runtime;
      if (runtime) {
        removePlayer(runtime, sessionId, context.now());
        syncState(state, runtime);
      }
    },

    onStart(context: GameContext, state: FallingPlatformsState): void {
      const runtime = state.runtime;
      if (runtime) {
        startMatch(runtime, context.now());
        syncState(state, runtime);
      }
    },

    onCommand(
      context: GameContext,
      state: FallingPlatformsState,
      sessionId: string,
      command: FallingPlatformsCommand,
    ): CommandResult {
      const runtime = state.runtime;
      if (!runtime) {
        return { ok: false, error: protocolError("INTERNAL_ERROR", "Game not initialised") };
      }
      if (command.type !== "hop") {
        return {
          ok: false,
          error: protocolError("INVALID_GAME_COMMAND", "Unknown Falling Platforms command"),
        };
      }
      const player = runtime.players.get(sessionId);
      if (!player) {
        return {
          ok: false,
          error: protocolError("PLAYER_NOT_IN_ROOM", "You are not in this room"),
        };
      }
      if (!consumeHopRateLimit(state, sessionId, context.now())) {
        context.emitToPlayer(sessionId, "hop-rejected", {
          sequence: command.sequence,
          reason: "rate-limited",
        });
        return { ok: true, data: { accepted: false, reason: "rate-limited" } };
      }
      const reason = validateHop(runtime, player, command.targetPlatformId, command.sequence);
      if (reason) {
        context.emitToPlayer(sessionId, "hop-rejected", {
          sequence: command.sequence,
          reason,
        });
        return { ok: true, data: { accepted: false, reason } };
      }
      startHop(runtime, player, command.targetPlatformId, command.sequence, context.now());
      const playerState = state.players.get(sessionId);
      if (playerState) {
        copyPlayer(playerState, player);
      }
      return { ok: true, data: { accepted: true } };
    },

    onTick(context: GameContext, state: FallingPlatformsState, now: number): void {
      const runtime = state.runtime;
      if (!runtime) {
        return;
      }
      updateMatch(runtime, now);
      syncState(state, runtime);
      if (runtime.phase === "results" && !runtime.resultsNotified) {
        runtime.resultsNotified = true;
        context.finishMatch(buildResult(runtime, now));
      } else if (runtime.phase === "lobby" && runtime.resultsNotified) {
        runtime.resultsNotified = false;
        context.returnToLobby();
      }
    },

    onReset(_context: GameContext, state: FallingPlatformsState): void {
      const runtime = state.runtime;
      if (!runtime) {
        return;
      }
      if (runtime.phase !== "lobby") {
        returnToLobby(runtime);
      }
      syncState(state, runtime);
    },
  };
}
