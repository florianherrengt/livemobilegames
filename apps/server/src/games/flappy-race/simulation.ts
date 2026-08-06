import { collisionObstacleIndex, updateClearedCount } from "./collision.js";
import { FLAPPY_RACE_SERVER_CONSTANTS } from "./constants.js";
import { stepBird } from "./physics.js";
import { resolveRound } from "./resolution.js";
import { beginRunning, candidatesOf, prepareRound, returnToLobby } from "./runtime.js";
import { buildFlappyRaceResult } from "./scoring.js";
import type { FlappyRaceRuntime } from "./types.js";

/**
 * Advances the authoritative simulation by one server tick. The Colyseus room
 * calls this on its interval and then projects the runtime onto the
 * synchronized schema. Keeping the loop outside the room makes phase
 * transitions, collisions, round resolution, and the final result testable
 * without networking.
 */
export function updateRuntime(runtime: FlappyRaceRuntime, now: number): void {
  if (runtime.phase === "countdown") {
    advanceSimulation(runtime, now);
    if (now >= runtime.countdownEndsAt) {
      beginRunning(runtime, now);
    }
  } else if (runtime.phase === "running") {
    advanceSimulation(runtime, now);
  } else if (runtime.phase === "round-result" && now >= runtime.resultsEndsAt) {
    if (runtime.roundNumber < runtime.totalRounds) {
      prepareRound(runtime, now, runtime.roundNumber + 1);
    } else {
      finishMatch(runtime);
    }
  }
}

export function evaluateRoundEnd(runtime: FlappyRaceRuntime, now: number): void {
  if (runtime.phase !== "countdown" && runtime.phase !== "running") {
    return;
  }
  if (runtime.roundEnded) {
    return;
  }
  const resolution = resolveRound(candidatesOf(runtime));
  if (resolution.outcome !== "resolved") {
    return;
  }
  runtime.roundEnded = true;
  if (resolution.reason === "no-eligible") {
    returnToLobby(runtime);
    return;
  }

  for (const sessionId of resolution.winnerSessionIds) {
    const player = runtime.players.get(sessionId);
    if (player?.eligible && !player.roundWonThisRound) {
      player.roundWins += 1;
      player.roundWonThisRound = true;
    }
  }
  runtime.roundWinnerSessionIds = [...resolution.winnerSessionIds];
  runtime.phase = "round-result";
  runtime.resultsEndsAt = now + runtime.settings.roundResultMs;
}

function advanceSimulation(runtime: FlappyRaceRuntime, now: number): void {
  let dt = now - runtime.lastTickAt;
  runtime.lastTickAt = now;
  if (dt < 0) {
    dt = 0;
  }
  if (dt > FLAPPY_RACE_SERVER_CONSTANTS.MAX_CATCH_UP_MS) {
    dt = FLAPPY_RACE_SERVER_CONSTANTS.MAX_CATCH_UP_MS;
  }
  runtime.simAccumMs += dt;
  while (runtime.simAccumMs >= FLAPPY_RACE_SERVER_CONSTANTS.SIMULATION_STEP_MS) {
    simulateStep(runtime, FLAPPY_RACE_SERVER_CONSTANTS.SIMULATION_STEP_MS, now);
    runtime.simAccumMs -= FLAPPY_RACE_SERVER_CONSTANTS.SIMULATION_STEP_MS;
    if (runtime.phase !== "countdown" && runtime.phase !== "running") {
      runtime.simAccumMs = 0;
      break;
    }
  }
}

function simulateStep(runtime: FlappyRaceRuntime, stepMs: number, now: number): void {
  for (const player of runtime.players.values()) {
    if (!player.roundActive || !player.eligible || !player.connected) {
      continue;
    }
    const flap = player.flapQueued;
    player.flapQueued = false;
    const next = stepBird(
      { y: player.birdY, vy: player.birdVy },
      flap,
      stepMs,
      FLAPPY_RACE_SERVER_CONSTANTS,
    );
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
      runtime.settings.courseSpeed,
      runtime.courseElapsedMs,
      FLAPPY_RACE_SERVER_CONSTANTS,
    );
    const hit = collisionObstacleIndex(
      player,
      player.birdY,
      runtime.openings,
      runtime.settings.courseSpeed,
      runtime.courseElapsedMs,
      FLAPPY_RACE_SERVER_CONSTANTS,
    );
    if (hit !== null) {
      player.roundActive = false;
      player.eliminated = true;
      player.flapQueued = false;
    }
  }
  evaluateRoundEnd(runtime, now);
}

function finishMatch(runtime: FlappyRaceRuntime): void {
  runtime.phase = "finished";
  runtime.resultsEndsAt = 0;
  runtime.result = buildFlappyRaceResult(runtime);
}
