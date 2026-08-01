import {
  buildLeaderboard,
  type GameContext,
  type GameDefinition,
} from "@falling-platforms/platform-server";
import { type CommandResult, protocolError } from "@falling-platforms/platform-shared";

import { type TapRaceCommand, tapRaceCommandSchema } from "./commands.js";
import { type TapRacePhase, TapRacePlayerState, TapRaceState } from "./state.js";

export const TAP_RACE_COUNTDOWN_MS = 3_000;
export const TAP_RACE_MATCH_MS = 10_000;
export const TAP_RACE_E2E_COUNTDOWN_MS = 500;
export const TAP_RACE_E2E_MATCH_MS = 2_000;
export const TAP_RACE_MAX_TAPS_PER_SECOND = 20;

export interface TapRaceGameOptions {
  e2eMode: boolean;
  reconnectGraceMs: number;
}

const tapTimestamps = new WeakMap<TapRaceState, Map<string, number[]>>();

function consumeTapRateLimit(state: TapRaceState, sessionId: string, now: number): boolean {
  let timestamps = tapTimestamps.get(state);
  if (!timestamps) {
    timestamps = new Map();
    tapTimestamps.set(state, timestamps);
  }
  const recent = (timestamps.get(sessionId) ?? []).filter((timestamp) => timestamp >= now - 1000);
  if (recent.length >= TAP_RACE_MAX_TAPS_PER_SECOND) {
    timestamps.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  timestamps.set(sessionId, recent);
  return true;
}

function buildResult(
  context: GameContext,
  state: TapRaceState,
): {
  winnerSessionIds: string[];
  leaderboard: Array<{
    sessionId: string;
    rank: number;
    primaryScore: number;
    label: string;
    secondaryLabel?: string | undefined;
  }>;
  finishedAt: number;
} {
  const result = buildLeaderboard(
    [...state.players.entries()].map(([sessionId, player]) => ({
      sessionId,
      primaryScore: player.score,
      label: player.name,
      secondaryLabel: `${player.score} taps`,
    })),
    context.now(),
  );
  return result;
}

export function createTapRaceGame(
  options: TapRaceGameOptions,
): GameDefinition<TapRaceState, TapRacePlayerState, TapRaceCommand> {
  const countdownMs = options.e2eMode ? TAP_RACE_E2E_COUNTDOWN_MS : TAP_RACE_COUNTDOWN_MS;
  const matchMs = options.e2eMode ? TAP_RACE_E2E_MATCH_MS : TAP_RACE_MATCH_MS;

  return {
    id: "tap_race",
    config: {
      minPlayers: 2,
      maxPlayers: 20,
      reconnectGraceMs: options.reconnectGraceMs,
      allowJoinAfterStart: false,
      removeDisconnectedPlayers: true,
      requiresReady: true,
    },
    commandSchema: tapRaceCommandSchema,

    createState(): TapRaceState {
      return new TapRaceState();
    },

    createPlayerState(): TapRacePlayerState {
      return new TapRacePlayerState();
    },

    onStart(context: GameContext, state: TapRaceState): void {
      state.phase = "countdown";
      state.startsAt = context.now() + countdownMs;
      context.scheduleIn("tap-race-countdown", countdownMs, () => {
        if (state.phase !== "countdown") {
          return;
        }
        state.phase = "playing";
        state.endsAt = context.now() + matchMs;
      });
      context.scheduleIn("tap-race-finish", countdownMs + matchMs, () => {
        if (state.phase !== "playing") {
          return;
        }
        state.phase = "finished";
        context.finishMatch(buildResult(context, state));
      });
    },

    onCommand(
      context: GameContext,
      state: TapRaceState,
      sessionId: string,
      command: TapRaceCommand,
    ): CommandResult {
      if (command.type !== "tap") {
        return {
          ok: false,
          error: protocolError("INVALID_GAME_COMMAND", "Unknown Tap Race command"),
        };
      }
      if (state.phase !== "playing") {
        return {
          ok: false,
          error: protocolError("GAME_NOT_RUNNING", "Taps are only accepted during the match"),
        };
      }
      if (!consumeTapRateLimit(state, sessionId, context.now())) {
        return { ok: false, error: protocolError("RATE_LIMITED", "Tapping too fast") };
      }
      const player = state.players.get(sessionId);
      if (!player) {
        return {
          ok: false,
          error: protocolError("PLAYER_NOT_IN_ROOM", "You are not in this room"),
        };
      }
      player.score += 1;
      return { ok: true, data: { score: player.score } };
    },

    onReset(_context: GameContext, state: TapRaceState): void {
      state.phase = "lobby";
      state.startsAt = 0;
      state.endsAt = 0;
      for (const player of state.players.values()) {
        player.score = 0;
      }
    },
  };
}

export type { TapRacePhase };
