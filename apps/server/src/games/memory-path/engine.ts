import { MEMORY_PATH_CONSTANTS } from "@phone-party/protocol";

import { MEMORY_PATH_SERVER_CONSTANTS } from "./constants.js";
import {
  distanceBetweenPoints,
  distanceToPolyline,
  normalizeInput,
  type Point2D,
  pathTotalLength,
  projectOnPath,
  segmentIntersectsCircle,
} from "./geometry.js";
import { prepareRound, returnToLobby, startMatch } from "./runtime.js";
import {
  allMatchLeaders,
  buildMatchResult,
  matchLeaders,
  resolveTimeoutWinner,
} from "./scoring.js";
import type { MemoryPathRuntime, RuntimePlayer } from "./types.js";

const PROGRESS_EPSILON = 1e-9;

export function difficultyForRound(roundNumber: number): "easy" | "medium" | "hard" {
  if (roundNumber <= 1) {
    return "easy";
  }
  if (roundNumber === 2) {
    return "medium";
  }
  return "hard";
}

export function insideCorridor(
  position: Point2D,
  routePoints: readonly Point2D[],
  pathWidth: number,
): boolean {
  const visibleHalfWidth = pathWidth / 2;
  const tolerance = pathWidth * MEMORY_PATH_SERVER_CONSTANTS.PATH_WIDTH_TOLERANCE_FRACTION;
  return distanceToPolyline(position, routePoints) <= visibleHalfWidth + tolerance;
}

export function progressAlongPath(position: Point2D, routePoints: readonly Point2D[]): number {
  const totalLength = pathTotalLength(routePoints);
  if (totalLength === 0) {
    return 0;
  }
  const projection = projectOnPath(position, routePoints);
  return Math.min(1, Math.max(0, projection.distanceAlong / totalLength));
}

function closestPointOnSegment(point: Point2D, start: Point2D, end: Point2D): Point2D {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { x: start.x, y: start.y };
  }
  const t = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return { x: start.x + t * dx, y: start.y + t * dy };
}

function beginPreview(runtime: MemoryPathRuntime, now: number): void {
  runtime.phase = "preview";
  runtime.previewEndsAt = now + runtime.settings.previewMs;
  runtime.pathVisible = true;
  runtime.opponentsVisible = true;
  runtime.lastTickAt = now;
}

function beginRace(runtime: MemoryPathRuntime, now: number): void {
  runtime.phase = "racing";
  runtime.raceStartedAt = now;
  runtime.raceEndsAt = now + runtime.settings.raceMs;
  runtime.raceElapsedMs = 0;
  runtime.pathVisible = false;
  runtime.opponentsVisible = false;
  runtime.lastTickAt = now;
  for (const player of runtime.players.values()) {
    player.inputX = 0;
    player.inputY = 0;
  }
}

function startFall(player: RuntimePlayer, now: number): void {
  player.falling = true;
  player.respawnEndsAt = now + MEMORY_PATH_CONSTANTS.RESPAWN_DELAY_MS;
  player.inputX = 0;
  player.inputY = 0;
  player.progress = 0;
}

function finishPlayer(player: RuntimePlayer): void {
  player.finished = true;
  player.roundActive = false;
  player.falling = false;
  player.respawnEndsAt = 0;
  player.inputX = 0;
  player.inputY = 0;
}

function endRound(
  runtime: MemoryPathRuntime,
  now: number,
  winnerSessionId: string,
  reason: "finish" | "timeout",
): void {
  const winner = runtime.players.get(winnerSessionId);
  if (winner) {
    winner.roundWins += 1;
  }
  const winnerProgress = winner?.maxProgress ?? 0;
  runtime.roundResult = {
    roundNumber: runtime.roundNumber,
    winnerSessionIds: [winnerSessionId],
    winnerLabel: winner?.name ?? "",
    reason,
    winnerProgress: Math.round(winnerProgress * 100),
    suddenDeath: runtime.suddenDeath,
  };
  runtime.roundResults.push(runtime.roundResult);
  runtime.phase = "round-result";
  runtime.resultsEndsAt = now + runtime.settings.roundResultMs;
  runtime.pathVisible = true;
  runtime.opponentsVisible = true;
  for (const player of runtime.players.values()) {
    player.inputX = 0;
    player.inputY = 0;
    player.roundActive = false;
  }
}

function finishMatch(runtime: MemoryPathRuntime): void {
  runtime.phase = "match-result";
  runtime.resultsEndsAt = 0;
  runtime.pathVisible = false;
  runtime.opponentsVisible = false;
  runtime.result = buildMatchResult(runtime);
}

function advanceRound(runtime: MemoryPathRuntime, now: number): void {
  if (runtime.roundNumber < MEMORY_PATH_CONSTANTS.NORMAL_ROUNDS) {
    const nextRound = runtime.roundNumber + 1;
    try {
      prepareRound(runtime, now, nextRound, difficultyForRound(nextRound), true);
    } catch (error) {
      if (!(error instanceof Error) || !/No unused .* route available/.test(error.message)) {
        throw error;
      }
      returnToLobby(runtime);
    }
    return;
  }

  if (!runtime.suddenDeath) {
    const leaders = matchLeaders(runtime);
    if (leaders.length === 1) {
      finishMatch(runtime);
      return;
    }
    runtime.suddenDeath = true;
    runtime.totalRounds = MEMORY_PATH_CONSTANTS.NORMAL_ROUNDS + 1;
    try {
      prepareRound(
        runtime,
        now,
        MEMORY_PATH_CONSTANTS.NORMAL_ROUNDS + 1,
        "hard",
        false,
        new Set(allMatchLeaders(runtime).map((leader) => leader.sessionId)),
      );
    } catch (error) {
      if (!(error instanceof Error) || !/No unused .* route available/.test(error.message)) {
        throw error;
      }
      returnToLobby(runtime);
    }
    return;
  }

  finishMatch(runtime);
}

function simulateRace(runtime: MemoryPathRuntime, now: number): void {
  let dt = now - runtime.lastTickAt;
  runtime.lastTickAt = now;
  if (dt < 0) {
    dt = 0;
  }
  if (dt > MEMORY_PATH_SERVER_CONSTANTS.MAX_CATCH_UP_MS) {
    dt = MEMORY_PATH_SERVER_CONSTANTS.MAX_CATCH_UP_MS;
  }
  const availableMs = Math.max(0, runtime.settings.raceMs - runtime.raceElapsedMs);
  const stepMs = Math.min(dt, availableMs);
  runtime.raceElapsedMs += stepMs;

  const interval = runtime.settings.flashIntervalMs;
  const flashStart =
    runtime.raceElapsedMs >= interval
      ? Math.floor(runtime.raceElapsedMs / interval) * interval
      : Number.POSITIVE_INFINITY;
  const flashActive =
    runtime.raceElapsedMs >= interval &&
    runtime.raceElapsedMs - flashStart < runtime.settings.flashDurationMs;
  runtime.pathVisible = flashActive;
  runtime.opponentsVisible = flashActive;

  const finishers: RuntimePlayer[] = [];
  const speed = runtime.settings.movementSpeed;
  const finish = {
    x: MEMORY_PATH_CONSTANTS.FINISH_X,
    y: MEMORY_PATH_CONSTANTS.FINISH_Y,
  };

  for (const player of runtime.players.values()) {
    if (player.falling) {
      if (now >= player.respawnEndsAt) {
        player.position = { x: MEMORY_PATH_CONSTANTS.START_X, y: MEMORY_PATH_CONSTANTS.START_Y };
        player.falling = false;
        player.respawnEndsAt = 0;
        player.progress = 0;
      }
      continue;
    }
    if (!player.connected || !player.participating || !player.roundActive || player.finished) {
      continue;
    }

    const previous = { ...player.position };
    const input = normalizeInput(player.inputX, player.inputY);
    const next = {
      x: Math.min(
        MEMORY_PATH_CONSTANTS.WORLD_WIDTH,
        Math.max(0, previous.x + input.x * speed * (stepMs / 1000)),
      ),
      y: Math.min(
        MEMORY_PATH_CONSTANTS.WORLD_HEIGHT,
        Math.max(0, previous.y + input.y * speed * (stepMs / 1000)),
      ),
    };

    if (!insideCorridor(next, runtime.route.points, runtime.pathWidth)) {
      const crossing = closestPointOnSegment(finish, previous, next);
      const crossedFinish =
        segmentIntersectsCircle(previous, next, finish, MEMORY_PATH_CONSTANTS.FINISH_RADIUS) &&
        insideCorridor(crossing, runtime.route.points, runtime.pathWidth);
      if (crossedFinish) {
        player.position = { ...crossing };
        player.progress = progressAlongPath(player.position, runtime.route.points);
        if (player.progress > player.maxProgress + PROGRESS_EPSILON) {
          player.maxProgress = player.progress;
          player.maxProgressFirstReachedAt = now;
        }
        finishPlayer(player);
        finishers.push(player);
      } else {
        startFall(player, now);
      }
      continue;
    }

    player.position = next;
    player.progress = progressAlongPath(next, runtime.route.points);
    if (player.progress > player.maxProgress + PROGRESS_EPSILON) {
      player.maxProgress = player.progress;
      player.maxProgressFirstReachedAt = now;
    }

    if (distanceBetweenPoints(next, finish) <= MEMORY_PATH_CONSTANTS.FINISH_RADIUS) {
      finishPlayer(player);
      finishers.push(player);
    }
  }

  if (finishers.length > 0) {
    finishers.sort((a, b) => a.joinedOrder - b.joinedOrder);
    const winner = finishers[0];
    if (winner) {
      endRound(runtime, now, winner.sessionId, "finish");
    }
    return;
  }

  const hasConnectedParticipant = [...runtime.players.values()].some(
    (player) => player.connected && player.participating,
  );
  if (!hasConnectedParticipant) {
    returnToLobby(runtime);
    return;
  }

  if (runtime.raceElapsedMs >= runtime.settings.raceMs) {
    const winnerSessionId = resolveTimeoutWinner([...runtime.players.values()]);
    if (winnerSessionId !== null) {
      endRound(runtime, now, winnerSessionId, "timeout");
    } else {
      returnToLobby(runtime);
    }
  }
}

/**
 * Advances the authoritative simulation by one server tick. The Colyseus room
 * calls this on its interval and then projects the runtime onto the
 * synchronized schema. Keeping the loop outside the room makes phase
 * transitions, path validation, falls, respawns, flashes, round resolution,
 * sudden death, and the final result testable without networking.
 */
export function updateRuntime(runtime: MemoryPathRuntime, now: number): void {
  if (runtime.phase === "preparing") {
    if (now >= runtime.preparingEndsAt) {
      beginPreview(runtime, now);
    }
  } else if (runtime.phase === "preview") {
    if (now >= runtime.previewEndsAt) {
      beginRace(runtime, now);
    }
  } else if (runtime.phase === "racing") {
    simulateRace(runtime, now);
  } else if (runtime.phase === "round-result") {
    if (now >= runtime.resultsEndsAt) {
      advanceRound(runtime, now);
    }
  }
}

/**
 * Called when a participant drops or leaves. Keeps the round running for the
 * remaining players and returns to the lobby only when nobody can play.
 */
export function evaluateNoEligible(runtime: MemoryPathRuntime): void {
  if (runtime.phase !== "preview" && runtime.phase !== "racing") {
    return;
  }
  const hasConnectedParticipant = [...runtime.players.values()].some(
    (player) => player.connected && player.participating,
  );
  if (!hasConnectedParticipant) {
    returnToLobby(runtime);
  }
}

export { startMatch };
