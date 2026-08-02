import type { GameContext, GameDefinition } from "@falling-platforms/platform-server";
import { buildLeaderboard } from "@falling-platforms/platform-server";
import { type CommandResult, protocolError } from "@falling-platforms/platform-shared";

import { collisionObstacleIndex, updateClearedCount } from "./collision.js";
import { type FlappyRaceCommand, flappyRaceCommandSchema } from "./commands.js";
import { FLAPPY_RACE_CONFIG } from "./constants.js";
import { stepBird } from "./physics.js";
import {
  consumeFlapRateLimit,
  createFlapTimestampMap,
  type FlapTimestampMap,
} from "./rate-limit.js";
import { resolveRound } from "./resolution.js";
import {
  assignColors,
  beginRunning,
  candidatesOf,
  createRuntime,
  createRuntimePlayer,
  createSettings,
  prepareRound,
  resetRuntime,
} from "./runtime.js";
import { FlappyRacePlayerState, FlappyRaceState } from "./state.js";
import { syncState } from "./sync.js";
import type { FlappyRaceRuntime, RuntimePlayer } from "./types.js";

export interface FlappyRaceGameOptions {
  e2eMode: boolean;
  reconnectGraceMs: number;
}

const COUNTDOWN_SCHEDULE = "flappy-countdown";
const ADVANCE_SCHEDULE = "flappy-advance";

function runtimeOf(state: FlappyRaceState): FlappyRaceRuntime {
  const runtime = state.runtime as FlappyRaceRuntime | null;
  if (!runtime) {
    throw new Error("Flappy Race runtime is not initialised");
  }
  return runtime;
}

export function createFlappyRaceGame(
  options: FlappyRaceGameOptions,
): GameDefinition<FlappyRaceState, FlappyRacePlayerState, FlappyRaceCommand> {
  const settings = createSettings(options.e2eMode);
  const config = settings.config;
  const flapTimestamps = new WeakMap<FlappyRaceState, FlapTimestampMap>();

  function startRound(state: FlappyRaceState, context: GameContext, roundNumber: number): void {
    const runtime = runtimeOf(state);
    runtime.roundNumber = roundNumber;
    prepareRound(runtime, context.now());

    context.scheduleIn(COUNTDOWN_SCHEDULE, settings.countdownMs, () => {
      const current = runtimeOf(state);
      if (current.phase === "countdown" && current.roundNumber === roundNumber) {
        beginRunning(current, context.now());
        syncState(state, current);
      }
    });
    syncState(state, runtime);
  }

  function endRound(
    state: FlappyRaceState,
    context: GameContext,
    winnerSessionIds: string[],
    reason: "all-eliminated" | "survivor-proved" | "sole-eligible" | "no-eligible",
  ): void {
    const runtime = runtimeOf(state);
    if (runtime.roundEnded) {
      return;
    }
    runtime.roundEnded = true;
    context.cancelSchedule(COUNTDOWN_SCHEDULE);
    context.cancelSchedule(ADVANCE_SCHEDULE);

    if (reason === "no-eligible") {
      // Everyone disconnected: terminate the match through the shared room
      // lifecycle instead of awarding phantom wins.
      context.returnToLobby();
      return;
    }

    for (const sessionId of winnerSessionIds) {
      const player = runtime.players.get(sessionId);
      if (player?.eligible && !player.roundWonThisRound) {
        player.roundWins += 1;
        player.roundWonThisRound = true;
      }
    }
    runtime.roundWinnerSessionIds = winnerSessionIds;
    syncState(state, runtime);

    if (runtime.roundNumber >= runtime.totalRounds) {
      finishMatch(state, context);
      return;
    }

    runtime.phase = "round-result";
    runtime.resultsEndsAt = context.now() + settings.roundResultMs;
    const finishedRound = runtime.roundNumber;
    context.scheduleIn(ADVANCE_SCHEDULE, settings.roundResultMs, () => {
      const current = runtimeOf(state);
      if (
        current.phase === "round-result" &&
        current.roundEnded &&
        current.roundNumber === finishedRound
      ) {
        startRound(state, context, finishedRound + 1);
      }
    });
    syncState(state, runtime);
  }

  function finishMatch(state: FlappyRaceState, context: GameContext): void {
    const runtime = runtimeOf(state);
    runtime.phase = "finished";
    context.cancelSchedule(COUNTDOWN_SCHEDULE);
    context.cancelSchedule(ADVANCE_SCHEDULE);
    syncState(state, runtime);

    const result = buildLeaderboard(
      [...runtime.players.values()].map((player) => ({
        sessionId: player.sessionId,
        primaryScore: player.roundWins,
        label: player.name,
        secondaryLabel: `${player.roundWins} round win${player.roundWins === 1 ? "" : "s"}`,
      })),
      context.now(),
    );
    context.finishMatch(result);
  }

  function evaluateRoundEnd(state: FlappyRaceState, context: GameContext): void {
    const runtime = runtimeOf(state);
    if (runtime.phase !== "countdown" && runtime.phase !== "running") {
      return;
    }
    const resolution = resolveRound(candidatesOf(runtime));
    if (resolution.outcome === "resolved") {
      endRound(state, context, resolution.winnerSessionIds, resolution.reason);
    }
  }

  function simulateStep(state: FlappyRaceState, context: GameContext, stepMs: number): void {
    const runtime = runtimeOf(state);
    if (runtime.phase !== "countdown" && runtime.phase !== "running") {
      return;
    }

    for (const player of runtime.players.values()) {
      if (!player.roundActive || !player.eligible || !player.connected) {
        continue;
      }
      const flap = player.flapQueued;
      player.flapQueued = false;
      const next = stepBird({ y: player.birdY, vy: player.birdVy }, flap, stepMs, config);
      player.birdY = next.y;
      player.birdVy = next.vy;
    }

    if (runtime.phase !== "running") {
      return;
    }

    runtime.courseElapsedMs += stepMs;
    for (const player of runtime.players.values()) {
      if (!player.roundActive || !player.eligible || !player.connected) {
        continue;
      }
      updateClearedCount(
        player,
        runtime.openings,
        settings.courseSpeed,
        runtime.courseElapsedMs,
        config,
      );
      const hit = collisionObstacleIndex(
        player,
        player.birdY,
        runtime.openings,
        settings.courseSpeed,
        runtime.courseElapsedMs,
        config,
      );
      if (hit !== null) {
        player.roundActive = false;
        player.eliminated = true;
        player.flapQueued = false;
      }
    }
    evaluateRoundEnd(state, context);
  }

  return {
    id: FLAPPY_RACE_CONFIG.gameId,
    config: {
      minPlayers: FLAPPY_RACE_CONFIG.minPlayers,
      maxPlayers: FLAPPY_RACE_CONFIG.maxPlayers,
      reconnectGraceMs: options.reconnectGraceMs,
      allowJoinAfterStart: false,
      removeDisconnectedPlayers: true,
      requiresReady: false,
    },
    commandSchema: flappyRaceCommandSchema,

    createState(): FlappyRaceState {
      const state = new FlappyRaceState();
      state.runtime = createRuntime(settings);
      return state;
    },

    createPlayerState(): FlappyRacePlayerState {
      return new FlappyRacePlayerState();
    },

    onStart(context: GameContext, state: FlappyRaceState): void {
      const runtime = runtimeOf(state);
      const connectedPlayers = context
        .getPlayers()
        .filter((player) => player.connectionStatus === "connected")
        .sort((a, b) => a.joinedOrder - b.joinedOrder);

      runtime.players = new Map();
      runtime.totalRounds = FLAPPY_RACE_CONFIG.totalRounds;
      for (const player of connectedPlayers) {
        const runtimePlayer = createRuntimePlayer(
          player.sessionId,
          player.name,
          player.joinedOrder,
          "",
        );
        runtime.players.set(player.sessionId, runtimePlayer);
      }
      assignColors(runtime);
      startRound(state, context, 1);
    },

    onCommand(
      context: GameContext,
      state: FlappyRaceState,
      sessionId: string,
      command: FlappyRaceCommand,
    ): CommandResult {
      const runtime = runtimeOf(state);
      if (command.type !== "flap") {
        return {
          ok: false,
          error: protocolError("INVALID_GAME_COMMAND", "Unknown Flappy Race command"),
        };
      }
      if (runtime.phase !== "countdown" && runtime.phase !== "running") {
        context.emitToPlayer(sessionId, "flap-rejected", {
          sequence: command.sequence,
          roundNumber: command.roundNumber,
          reason: "not-running",
        });
        return {
          ok: false,
          error: protocolError("GAME_NOT_RUNNING", "Flaps are only accepted during a round"),
        };
      }
      const player = runtime.players.get(sessionId);
      if (!player) {
        return {
          ok: false,
          error: protocolError("PLAYER_NOT_IN_ROOM", "You are not a participant in this game"),
        };
      }
      if (!player.eligible || !player.roundActive || !player.connected) {
        context.emitToPlayer(sessionId, "flap-rejected", {
          sequence: command.sequence,
          roundNumber: command.roundNumber,
          reason: "not-active",
        });
        return {
          ok: false,
          error: protocolError("INVALID_GAME_COMMAND", "You are not active in this round"),
        };
      }
      if (command.roundNumber !== runtime.roundNumber) {
        context.emitToPlayer(sessionId, "flap-rejected", {
          sequence: command.sequence,
          roundNumber: command.roundNumber,
          reason: "old-round",
        });
        return {
          ok: false,
          error: protocolError("INVALID_GAME_COMMAND", "This flap belongs to an old round"),
        };
      }
      if (command.sequence <= player.lastFlapSequence - 64) {
        context.emitToPlayer(sessionId, "flap-rejected", {
          sequence: command.sequence,
          roundNumber: command.roundNumber,
          reason: "stale-sequence",
        });
        return {
          ok: false,
          error: protocolError("INVALID_GAME_COMMAND", "Flap sequence is too old"),
        };
      }
      if (player.seenFlapSequences.has(command.sequence)) {
        // Duplicate delivery/retry: deduplicated silently so retries never
        // double-flap, but rejected without feedback spam.
        return { ok: true, data: { accepted: false, reason: "duplicate" } };
      }
      let timestamps = flapTimestamps.get(state);
      if (!timestamps) {
        timestamps = createFlapTimestampMap();
        flapTimestamps.set(state, timestamps);
      }
      if (!consumeFlapRateLimit(config, timestamps, sessionId, context.now())) {
        context.emitToPlayer(sessionId, "flap-rejected", {
          sequence: command.sequence,
          roundNumber: command.roundNumber,
          reason: "rate-limited",
        });
        return { ok: false, error: protocolError("RATE_LIMITED", "Flapping too fast") };
      }

      player.seenFlapSequences.add(command.sequence);
      player.lastFlapSequence = Math.max(player.lastFlapSequence, command.sequence);
      player.flapQueued = true;
      return { ok: true, data: { accepted: true } };
    },

    onTick(context: GameContext, state: FlappyRaceState, now: number): void {
      const runtime = runtimeOf(state);
      if (runtime.phase !== "countdown" && runtime.phase !== "running") {
        return;
      }
      let dt = now - runtime.lastTickAt;
      runtime.lastTickAt = now;
      if (dt < 0) {
        dt = 0;
      }
      if (dt > config.maxCatchUpMs) {
        dt = config.maxCatchUpMs;
      }
      runtime.simAccumMs += dt;
      while (runtime.simAccumMs >= config.simulationStepMs) {
        simulateStep(state, context, config.simulationStepMs);
        runtime.simAccumMs -= config.simulationStepMs;
        if (runtime.phase !== "countdown" && runtime.phase !== "running") {
          runtime.simAccumMs = 0;
          break;
        }
      }
      // Evaluate drop-triggered eliminations here, after every pending drop
      // mutation has had a chance to land on the serial queue, so an
      // all-disconnect room resets instead of awarding a phantom win.
      evaluateRoundEnd(state, context);
      syncState(state, runtime);
    },

    onDrop(_context: GameContext, state: FlappyRaceState, sessionId: string): void {
      const runtime = runtimeOf(state);
      const player = runtime.players.get(sessionId);
      if (!player) {
        return;
      }
      player.connected = false;
      player.eligible = false;
      player.roundActive = false;
      player.eliminated = true;
      player.flapQueued = false;
      syncState(state, runtime);
    },

    onReconnect(_context: GameContext, state: FlappyRaceState, sessionId: string): void {
      const runtime = runtimeOf(state);
      const player = runtime.players.get(sessionId);
      if (player) {
        // Reconnecting users spectate the rest of this match; they never
        // resume control of their former bird.
        player.connected = true;
      }
      syncState(state, runtime);
    },

    onRemoved(context: GameContext, state: FlappyRaceState, sessionId: string): void {
      const runtime = runtimeOf(state);
      runtime.players.delete(sessionId);
      if (runtime.phase === "countdown" || runtime.phase === "running") {
        evaluateRoundEnd(state, context);
      }
      syncState(state, runtime);
    },

    onReset(context: GameContext, state: FlappyRaceState): void {
      const runtime = runtimeOf(state);
      context.cancelSchedule(COUNTDOWN_SCHEDULE);
      context.cancelSchedule(ADVANCE_SCHEDULE);
      resetRuntime(runtime);
      syncState(state, runtime);
    },
  };
}

export type { RuntimePlayer };
