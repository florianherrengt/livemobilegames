import {
  buildLeaderboard,
  type GameContext,
  type GameDefinition,
} from "@falling-platforms/platform-server";
import { type CommandResult, protocolError } from "@falling-platforms/platform-shared";
import { CAPITALS } from "./capitals.js";
import { type CapitalPinCommand, capitalPinCommandSchema } from "./commands.js";
import { CAPITAL_PIN_CONSTANTS } from "./constants.js";
import {
  allConnectedParticipantsSubmitted,
  type CapitalPinRuntime,
  createRuntime,
} from "./runtime.js";
import { applyRoundResultToScores, buildRoundResult } from "./scoring.js";
import { selectUniqueCapitals } from "./selection.js";
import { type CapitalPinPhase, CapitalPinPlayerState, CapitalPinState } from "./state.js";
import { clearGameProjection, syncState } from "./sync.js";
import { emptyScore } from "./types.js";
import { validateCapitalDataset } from "./validation.js";

export interface CapitalPinGameOptions {
  e2eMode: boolean;
  reconnectGraceMs: number;
}

const ROUND_END_SCHEDULE = "cp-round-end";
const ADVANCE_SCHEDULE = "cp-advance";

// Expose the authoritative dataset so tools/tests can resolve ground truth
// (e.g. verify a revealed capital pin against the correct coordinates).
export { CAPITALS } from "./capitals.js";
// Re-export the dataset validator for callers that supply custom datasets.
export { validateCapitalDataset } from "./validation.js";

export function createCapitalPinGame(
  options: CapitalPinGameOptions,
): GameDefinition<CapitalPinState, CapitalPinPlayerState, CapitalPinCommand> {
  const roundDurationMs = options.e2eMode
    ? CAPITAL_PIN_CONSTANTS.E2E_ROUND_DURATION_MS
    : CAPITAL_PIN_CONSTANTS.ROUND_DURATION_MS;
  const resultsDurationMs = options.e2eMode
    ? CAPITAL_PIN_CONSTANTS.E2E_RESULTS_DURATION_MS
    : CAPITAL_PIN_CONSTANTS.RESULTS_DURATION_MS;

  // Fail fast on a malformed dataset before serving any room.
  validateCapitalDataset(CAPITALS);

  // --- Round lifecycle. Inner closures close over the configured durations. ---

  function startNextRound(state: CapitalPinState, context: GameContext): void {
    const runtime = runtimeOf(state);
    if (runtime.nextRoundIndex >= runtime.capitals.length) {
      finishGame(state, context);
      return;
    }
    const capital = runtime.capitals[runtime.nextRoundIndex];
    if (!capital) {
      finishGame(state, context);
      return;
    }
    const roundNumber = runtime.nextRoundIndex + 1;
    const now = context.now();
    runtime.currentRound = {
      roundNumber,
      capital,
      startedAt: now,
      endsAt: now + roundDurationMs,
      guesses: new Map(),
      finished: false,
    };
    runtime.nextRoundIndex += 1;
    runtime.phase = "round";

    syncState(state, runtime, nameOf(state), connectedSessionIds(context));

    context.scheduleIn(ROUND_END_SCHEDULE, roundDurationMs, () => {
      const current = runtime.currentRound;
      if (runtime.phase !== "round" || !current || current.finished) {
        return;
      }
      endRound(state, context);
    });
  }

  function endRound(state: CapitalPinState, context: GameContext): void {
    const runtime = runtimeOf(state);
    const round = runtime.currentRound;
    if (!round || round.finished) {
      return;
    }
    round.finished = true;
    // The round timer is superseded by the advance timer.
    context.cancelSchedule(ROUND_END_SCHEDULE);

    const result = buildRoundResult(
      runtime.participantIds,
      round.capital,
      round.roundNumber,
      round.guesses,
    );
    runtime.lastResult = result;
    applyRoundResultToScores(runtime.scores, result);
    runtime.phase = "round-results";
    // Reuse endsAt to mark when the results screen advances.
    round.endsAt = context.now() + resultsDurationMs;

    syncState(state, runtime, nameOf(state), connectedSessionIds(context));

    context.scheduleIn(ADVANCE_SCHEDULE, resultsDurationMs, () => {
      if (runtime.phase !== "round-results") {
        return;
      }
      runtime.currentRound = null;
      startNextRound(state, context);
    });
  }

  function finishGame(state: CapitalPinState, context: GameContext): void {
    const runtime = runtimeOf(state);
    runtime.phase = "finished";
    runtime.currentRound = null;
    context.cancelSchedule(ROUND_END_SCHEDULE);
    context.cancelSchedule(ADVANCE_SCHEDULE);
    syncState(state, runtime, nameOf(state), connectedSessionIds(context));

    // Winners are decided by round wins (primaryScore); total distance is
    // surfaced as secondary context. Standard competition ranking makes equal
    // round-win counts joint winners.
    const result = buildLeaderboard(
      runtime.participantIds.map((sessionId) => ({
        sessionId,
        primaryScore: runtime.scores.get(sessionId)?.roundWins ?? 0,
        label: nameOf(state)(sessionId),
        secondaryLabel: formatScoreLabel(runtime.scores.get(sessionId)),
      })),
      context.now(),
    );
    context.finishMatch(result);
  }

  return {
    id: "capital_pin",
    config: {
      minPlayers: CAPITAL_PIN_CONSTANTS.MIN_PLAYERS,
      maxPlayers: CAPITAL_PIN_CONSTANTS.MAX_PLAYERS,
      reconnectGraceMs: options.reconnectGraceMs,
      // No new players once a game is underway; the participant list is frozen.
      allowJoinAfterStart: false,
      removeDisconnectedPlayers: true,
      // Host-only start, like the original game (no ready requirement).
      requiresReady: false,
    },
    commandSchema: capitalPinCommandSchema,

    createState(): CapitalPinState {
      const state = new CapitalPinState();
      // Server-only authoritative state, never encoded. The schema is a derived
      // projection kept in sync via syncState().
      attachRuntime(state, createRuntime());
      return state;
    },

    createPlayerState(): CapitalPinPlayerState {
      return new CapitalPinPlayerState();
    },

    onStart(context: GameContext, state: CapitalPinState): void {
      const runtime = runtimeOf(state);
      const players = context.getPlayers();
      const participantIds = [...players]
        .sort((a, b) => a.joinedOrder - b.joinedOrder)
        .map((player) => player.sessionId);

      runtime.participantIds = participantIds;
      runtime.scores = new Map(participantIds.map((id) => [id, emptyScore()]));
      runtime.totalRounds = CAPITAL_PIN_CONSTANTS.TOTAL_ROUNDS;
      runtime.capitals = selectUniqueCapitals(
        CAPITALS as {
          id: string;
          city: string;
          country: string;
          latitude: number;
          longitude: number;
        }[],
        runtime.totalRounds,
      );
      runtime.nextRoundIndex = 0;
      runtime.currentRound = null;
      runtime.lastResult = null;

      startNextRound(state, context);
    },

    onCommand(
      context: GameContext,
      state: CapitalPinState,
      sessionId: string,
      command: CapitalPinCommand,
    ): CommandResult {
      const runtime = runtimeOf(state);
      const round = runtime.currentRound;

      if (runtime.phase !== "round" || !round || round.finished) {
        return {
          ok: false,
          error: protocolError("GAME_NOT_RUNNING", "There is no active round"),
        };
      }
      if (!runtime.participantIds.includes(sessionId)) {
        return {
          ok: false,
          error: protocolError("PLAYER_NOT_IN_ROOM", "You are not a participant in this game"),
        };
      }
      if (round.roundNumber !== command.roundNumber) {
        return {
          ok: false,
          error: protocolError("GAME_NOT_RUNNING", "This round is no longer active"),
        };
      }
      if (context.now() > round.endsAt) {
        return {
          ok: false,
          error: protocolError("GAME_NOT_RUNNING", "Time is up for this round"),
        };
      }
      if (round.guesses.has(sessionId)) {
        return {
          ok: false,
          error: protocolError("INVALID_GAME_COMMAND", "You have already locked your answer"),
        };
      }

      round.guesses.set(sessionId, {
        sessionId,
        latitude: command.latitude,
        longitude: command.longitude,
        submittedAt: context.now(),
      });

      syncState(state, runtime, nameOf(state), connectedSessionIds(context));

      // Early finish once every connected participant has locked in.
      if (allConnectedParticipantsSubmitted(runtime, connectedSessionIds(context))) {
        endRound(state, context);
      }
      return { ok: true };
    },

    onReset(_context: GameContext, state: CapitalPinState): void {
      const runtime = runtimeOf(state);
      resetToLobby(runtime);
      clearGameProjection(state);
    },

    onRemoved(context: GameContext, state: CapitalPinState, sessionId: string): void {
      const runtime = runtimeOf(state);
      const wasParticipant = runtime.participantIds.includes(sessionId);
      // Drop the departing player's pending guess so they can't block an early
      // finish, and forget their accumulated score.
      runtime.currentRound?.guesses.delete(sessionId);
      runtime.scores.delete(sessionId);
      runtime.participantIds = runtime.participantIds.filter((id) => id !== sessionId);
      syncState(state, runtime, nameOf(state), connectedSessionIds(context));
      // A mid-round disconnect may unblock an early finish.
      if (wasParticipant && runtime.phase === "round" && runtime.currentRound) {
        if (allConnectedParticipantsSubmitted(runtime, connectedSessionIds(context))) {
          endRound(state, context);
        }
      }
    },
  };
}

function resetToLobby(runtime: CapitalPinRuntime): void {
  runtime.phase = "lobby";
  runtime.participantIds = [];
  runtime.capitals = [];
  runtime.totalRounds = 0;
  runtime.nextRoundIndex = 0;
  runtime.currentRound = null;
  runtime.lastResult = null;
  runtime.scores = new Map();
}

// --- Runtime attachment + lookups ---

const RUNTIME_KEY = "runtime" as const;

type CapitalPinStateWithRuntime = CapitalPinState & {
  runtime: CapitalPinRuntime;
};

function attachRuntime(state: CapitalPinState, runtime: CapitalPinRuntime): void {
  (state as CapitalPinStateWithRuntime)[RUNTIME_KEY] = runtime;
}

function runtimeOf(state: CapitalPinState): CapitalPinRuntime {
  const runtime = (state as CapitalPinStateWithRuntime)[RUNTIME_KEY];
  if (!runtime) {
    throw new Error("Capital Pin runtime is not initialised");
  }
  return runtime;
}

/**
 * Resolve a sessionId -> display name for the projection. Names live on the
 * platform player rows, which exist before the game starts.
 */
function nameOf(state: CapitalPinState): (sessionId: string) => string {
  return (sessionId: string) => state.players.get(sessionId)?.name ?? "Unknown";
}

function connectedSessionIds(context: GameContext): Set<string> {
  return new Set(
    context
      .getPlayers()
      .filter((player) => player.connectionStatus === "connected")
      .map((player) => player.sessionId),
  );
}

function formatScoreLabel(
  score: { totalDistanceKm: number; roundWins: number } | undefined,
): string {
  if (!score) return "0 wins";
  return `${score.roundWins} wins · ${Math.round(score.totalDistanceKm).toLocaleString("en-US")} km`;
}

export type { CapitalPinPhase };
