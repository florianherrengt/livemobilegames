import {
  expandGolfHazard,
  type GolfCourse,
  type GolfShotRejectionReason,
  golfHazardGrowthForRound,
} from "@phone-party/protocol";

import { GOLF_SERVER_CONSTANTS, playerColorFor } from "./constants.js";
import { buildRouteDistances, computeProgress } from "./geometry.js";
import {
  crossesSegment,
  isInsideHazard,
  pointInsideHazardForPlacement,
  speedOf,
  stepPhysics,
} from "./physics.js";
import type {
  GolfLeaderboardEntry,
  GolfResult,
  GolfRuntime,
  GolfSettings,
  RuntimePlayer,
} from "./types.js";

export function createSettings(e2eMode: boolean): GolfSettings {
  return {
    config: GOLF_SERVER_CONSTANTS,
    e2eMode,
    aimMs: e2eMode ? GOLF_SERVER_CONSTANTS.E2E_AIM_MS : GOLF_SERVER_CONSTANTS.AIM_MS,
    countdownMs: e2eMode
      ? GOLF_SERVER_CONSTANTS.E2E_COUNTDOWN_MS
      : GOLF_SERVER_CONSTANTS.COUNTDOWN_MS,
    immunityMs: e2eMode ? GOLF_SERVER_CONSTANTS.E2E_IMMUNITY_MS : GOLF_SERVER_CONSTANTS.IMMUNITY_MS,
    roundResultMs: e2eMode
      ? GOLF_SERVER_CONSTANTS.E2E_ROUND_RESULT_MS
      : GOLF_SERVER_CONSTANTS.ROUND_RESULT_MS,
    roundMaxDurationMs: e2eMode
      ? GOLF_SERVER_CONSTANTS.E2E_ROUND_MAX_DURATION_MS
      : GOLF_SERVER_CONSTANTS.ROUND_MAX_DURATION_MS,
    maxShotSpeed: e2eMode
      ? GOLF_SERVER_CONSTANTS.E2E_MAX_SHOT_SPEED
      : GOLF_SERVER_CONSTANTS.MAX_SHOT_SPEED,
  };
}

export function createRuntime(settings: GolfSettings, course: GolfCourse): GolfRuntime {
  return {
    phase: "lobby",
    course,
    roundCourse: course,
    routeDistances: buildRouteDistances(course),
    settings,
    roundNumber: 0,
    totalRounds: GOLF_SERVER_CONSTANTS.TOTAL_ROUNDS,
    roundWinnerSessionIds: [],
    resultsEndsAt: 0,
    roundEndsAt: 0,
    roundParticipantCount: 0,
    turnOrder: [],
    turnIndex: 0,
    currentTurnSessionId: "",
    aimingEndsAt: 0,
    countdownEndsAt: 0,
    lastTickAt: 0,
    simAccumMs: 0,
    finishOrder: 0,
    players: new Map(),
    result: null,
  };
}

export function addPlayer(
  runtime: GolfRuntime,
  sessionId: string,
  name: string,
  joinedOrder: number,
): RuntimePlayer {
  const player: RuntimePlayer = {
    sessionId,
    name,
    connected: true,
    removed: false,
    color: "",
    joinedOrder,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    moving: false,
    stoppedSince: null,
    latestGateIndex: -1,
    raceProgress: 0,
    sectionProgress: 0,
    finished: false,
    finishedRank: 0,
    timedOut: false,
    roundWins: 0,
    matchPoints: 0,
    playedThisRound: false,
    shotTakenThisTurn: false,
    collisionImmunityUntil: 0,
    protectedNextTurn: false,
    lastShotSequence: 0,
    seenShotSequences: new Set(),
  };
  runtime.players.set(sessionId, player);
  return player;
}

export function removePlayer(
  runtime: GolfRuntime,
  sessionId: string,
  preserveMatchResult = false,
): void {
  const player = runtime.players.get(sessionId);
  if (preserveMatchResult && player !== undefined) {
    player.connected = false;
    player.removed = true;
    player.vx = 0;
    player.vy = 0;
    player.moving = false;
    player.stoppedSince = null;
    player.shotTakenThisTurn = true;
  } else {
    runtime.players.delete(sessionId);
  }
  runtime.turnOrder = runtime.turnOrder.filter((id) => id !== sessionId);
  if (runtime.currentTurnSessionId === sessionId) {
    runtime.currentTurnSessionId = "";
    runtime.aimingEndsAt = 0;
  }
}

export function startMatch(runtime: GolfRuntime, now: number): boolean {
  const connected = [...runtime.players.values()].filter(
    (player) => player.connected && !player.removed,
  );
  if (connected.length < GOLF_SERVER_CONSTANTS.MIN_PLAYERS) {
    return false;
  }
  const ordered = connected.sort((a, b) => a.joinedOrder - b.joinedOrder);
  for (const player of ordered) {
    resetPlayerForMatch(player);
    const start = runtime.course.startingPositions[player.joinedOrder];
    if (!start) {
      throw new Error(
        `Golf course ${runtime.course.id}: missing starting position ${player.joinedOrder}`,
      );
    }
    player.x = start.x;
    player.y = start.y;
    player.color = playerColorFor(player.joinedOrder);
  }
  runtime.phase = "countdown";
  runtime.roundNumber = 1;
  runtime.totalRounds = GOLF_SERVER_CONSTANTS.TOTAL_ROUNDS;
  runtime.roundWinnerSessionIds = [];
  runtime.resultsEndsAt = 0;
  runtime.roundEndsAt = 0;
  runtime.roundParticipantCount = ordered.length;
  runtime.countdownEndsAt = now + runtime.settings.countdownMs;
  runtime.aimingEndsAt = 0;
  runtime.turnOrder = [];
  runtime.turnIndex = 0;
  runtime.currentTurnSessionId = "";
  runtime.finishOrder = 0;
  runtime.result = null;
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
  prepareRoundCourse(runtime, runtime.roundNumber);
  return true;
}

function resetPlayerForMatch(player: RuntimePlayer): void {
  player.vx = 0;
  player.vy = 0;
  player.moving = false;
  player.stoppedSince = null;
  player.latestGateIndex = -1;
  player.raceProgress = 0;
  player.sectionProgress = 0;
  player.finished = false;
  player.finishedRank = 0;
  player.timedOut = false;
  player.roundWins = 0;
  player.matchPoints = 0;
  player.playedThisRound = false;
  player.shotTakenThisTurn = false;
  player.collisionImmunityUntil = 0;
  player.protectedNextTurn = false;
  player.lastShotSequence = 0;
  player.seenShotSequences.clear();
}

export function resetForNewMatch(runtime: GolfRuntime): void {
  for (const [sessionId, player] of runtime.players) {
    if (player.removed) {
      runtime.players.delete(sessionId);
    }
  }
  runtime.phase = "lobby";
  runtime.roundNumber = 0;
  runtime.totalRounds = GOLF_SERVER_CONSTANTS.TOTAL_ROUNDS;
  runtime.roundWinnerSessionIds = [];
  runtime.resultsEndsAt = 0;
  runtime.roundEndsAt = 0;
  runtime.roundParticipantCount = 0;
  runtime.countdownEndsAt = 0;
  runtime.aimingEndsAt = 0;
  runtime.turnOrder = [];
  runtime.turnIndex = 0;
  runtime.currentTurnSessionId = "";
  runtime.finishOrder = 0;
  runtime.result = null;
  runtime.lastTickAt = 0;
  runtime.simAccumMs = 0;
  runtime.roundCourse = runtime.course;
  for (const player of runtime.players.values()) {
    resetPlayerForMatch(player);
  }
}

function resetPlayerForRound(runtime: GolfRuntime, player: RuntimePlayer): void {
  const start = runtime.course.startingPositions[player.joinedOrder];
  if (!start) {
    throw new Error(
      `Golf course ${runtime.course.id}: missing starting position ${player.joinedOrder}`,
    );
  }
  player.x = start.x;
  player.y = start.y;
  player.vx = 0;
  player.vy = 0;
  player.moving = false;
  player.stoppedSince = null;
  player.latestGateIndex = -1;
  player.raceProgress = 0;
  player.sectionProgress = 0;
  player.finished = false;
  player.finishedRank = 0;
  player.timedOut = false;
  player.playedThisRound = false;
  player.shotTakenThisTurn = false;
  player.collisionImmunityUntil = 0;
  player.protectedNextTurn = false;
  player.lastShotSequence = 0;
  player.seenShotSequences.clear();
}

function prepareRoundCourse(runtime: GolfRuntime, roundNumber: number): void {
  const growth = golfHazardGrowthForRound(roundNumber);
  runtime.roundCourse = {
    ...runtime.course,
    hazards: runtime.course.hazards.map((hazard) => expandGolfHazard(hazard, growth)),
  };
}

export function updateRuntime(runtime: GolfRuntime, now: number): void {
  if (runtime.phase === "countdown") {
    if (now >= runtime.countdownEndsAt) {
      runtime.roundEndsAt = now + runtime.settings.roundMaxDurationMs;
      beginRound(runtime, now);
    }
  } else if (
    (runtime.phase === "aiming" || runtime.phase === "simulating") &&
    runtime.roundEndsAt > 0 &&
    now >= runtime.roundEndsAt
  ) {
    finishRoundAtDeadline(runtime, now);
  } else if (runtime.phase === "aiming") {
    if (now >= runtime.aimingEndsAt) {
      const active = runtime.players.get(runtime.currentTurnSessionId);
      if (active) {
        active.playedThisRound = true;
        active.shotTakenThisTurn = true;
        clearTurnImmunity(active);
      }
      finishTurn(runtime, now);
    }
  } else if (runtime.phase === "simulating") {
    advanceSimulation(runtime, now);
  } else if (runtime.phase === "round-result" && now >= runtime.resultsEndsAt) {
    if (runtime.roundNumber < runtime.totalRounds) {
      startNextRound(runtime, now);
    } else {
      finishMatch(runtime);
    }
  }
}

export function submitShot(
  runtime: GolfRuntime,
  sessionId: string,
  command: { sequence: number; roundNumber: number; aimX: number; aimY: number },
  now: number,
): GolfShotRejectionReason | null {
  if (runtime.phase !== "aiming") {
    return "not-aiming";
  }
  if (runtime.currentTurnSessionId !== sessionId) {
    return "not-your-turn";
  }
  const player = runtime.players.get(sessionId);
  if (!player) {
    return "not-your-turn";
  }
  if (now > runtime.aimingEndsAt) {
    return "timer-expired";
  }
  if (command.roundNumber !== runtime.roundNumber) {
    return "old-round";
  }
  if (player.finished) {
    return "finished";
  }
  if (player.shotTakenThisTurn) {
    return "already-shot";
  }
  if (player.moving) {
    return "ball-moving";
  }
  if (
    player.seenShotSequences.has(command.sequence) ||
    command.sequence < player.lastShotSequence - 64
  ) {
    return "stale-sequence";
  }
  const dragMagnitude = Math.hypot(command.aimX, command.aimY);
  if (dragMagnitude < GOLF_SERVER_CONSTANTS.MIN_DRAG_PX) {
    return "below-minimum-power";
  }
  const clampedDrag = Math.min(dragMagnitude, GOLF_SERVER_CONSTANTS.MAX_DRAG_PX);
  const speed = (clampedDrag / GOLF_SERVER_CONSTANTS.MAX_DRAG_PX) * runtime.settings.maxShotSpeed;
  const directionX = -command.aimX / dragMagnitude;
  const directionY = -command.aimY / dragMagnitude;

  player.seenShotSequences.add(command.sequence);
  player.lastShotSequence = Math.max(player.lastShotSequence, command.sequence);
  for (const sequence of [...player.seenShotSequences]) {
    if (sequence < player.lastShotSequence - 64) {
      player.seenShotSequences.delete(sequence);
    }
  }
  player.vx += directionX * speed;
  player.vy += directionY * speed;
  player.moving = true;
  player.stoppedSince = null;
  player.shotTakenThisTurn = true;
  clearTurnImmunity(player);

  runtime.phase = "simulating";
  runtime.aimingEndsAt = 0;
  runtime.currentTurnSessionId = "";
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
  return null;
}

function beginRound(runtime: GolfRuntime, now: number): void {
  const unfinished = [...runtime.players.values()]
    .filter((player) => !player.removed && !player.finished)
    .sort((a, b) => a.raceProgress - b.raceProgress || a.joinedOrder - b.joinedOrder);
  for (const player of unfinished) {
    player.playedThisRound = false;
    player.shotTakenThisTurn = false;
  }
  runtime.turnOrder = unfinished.map((player) => player.sessionId);
  runtime.turnIndex = 0;
  startNextTurn(runtime, now);
}

function startNextTurn(runtime: GolfRuntime, now: number): void {
  const participants = currentRoundParticipants(runtime);
  if (participants.length === 0) {
    finishMatch(runtime);
    return;
  }
  while (runtime.turnIndex < runtime.turnOrder.length) {
    const sessionId = runtime.turnOrder[runtime.turnIndex];
    if (!sessionId) {
      runtime.turnIndex += 1;
      continue;
    }
    const player = runtime.players.get(sessionId);
    if (!player || player.removed || player.finished || player.playedThisRound) {
      runtime.turnIndex += 1;
      continue;
    }
    runtime.currentTurnSessionId = sessionId;
    runtime.phase = "aiming";
    runtime.aimingEndsAt = now + runtime.settings.aimMs;
    player.playedThisRound = true;
    player.shotTakenThisTurn = false;
    return;
  }

  if (participants.every((player) => player.finished)) {
    finishRound(runtime, now);
    return;
  }
  beginRound(runtime, now);
}

function finishTurn(runtime: GolfRuntime, now: number): void {
  runtime.currentTurnSessionId = "";
  runtime.aimingEndsAt = 0;
  if (currentRoundParticipants(runtime).every((player) => player.finished)) {
    finishRound(runtime, now);
    return;
  }
  runtime.turnIndex += 1;
  startNextTurn(runtime, now);
}

function finishRound(runtime: GolfRuntime, now: number): void {
  const ordered = [...runtime.players.values()]
    .filter((player) => player.finished && player.finishedRank > 0)
    .sort((a, b) => a.finishedRank - b.finishedRank || a.joinedOrder - b.joinedOrder);
  runtime.roundWinnerSessionIds = ordered
    .filter((player) => player.finishedRank === 1)
    .map((player) => player.sessionId);
  for (const player of ordered) {
    if (!player.finished) {
      continue;
    }
    if (player.finishedRank === 1) {
      player.roundWins += 1;
    }
    player.matchPoints += Math.max(1, runtime.roundParticipantCount - player.finishedRank + 1);
  }
  runtime.phase = "round-result";
  runtime.roundEndsAt = 0;
  runtime.resultsEndsAt = now + runtime.settings.roundResultMs;
}

function finishRoundAtDeadline(runtime: GolfRuntime, now: number): void {
  const unfinished = currentRoundParticipants(runtime)
    .filter((player) => !player.finished)
    .sort(
      (a, b) =>
        b.raceProgress - a.raceProgress ||
        b.latestGateIndex - a.latestGateIndex ||
        b.sectionProgress - a.sectionProgress ||
        a.joinedOrder - b.joinedOrder,
    );
  for (const player of unfinished) {
    runtime.finishOrder += 1;
    player.finished = true;
    player.finishedRank = runtime.finishOrder;
    player.timedOut = true;
    player.vx = 0;
    player.vy = 0;
    player.moving = false;
    player.stoppedSince = null;
  }
  finishRound(runtime, now);
}

function startNextRound(runtime: GolfRuntime, now: number): void {
  runtime.roundNumber += 1;
  runtime.roundWinnerSessionIds = [];
  runtime.resultsEndsAt = 0;
  runtime.roundEndsAt = now + runtime.settings.roundMaxDurationMs;
  runtime.roundParticipantCount = currentRoundParticipants(runtime).length;
  runtime.finishOrder = 0;
  for (const player of runtime.players.values()) {
    resetPlayerForRound(runtime, player);
  }
  prepareRoundCourse(runtime, runtime.roundNumber);
  beginRound(runtime, now);
}

function advanceSimulation(runtime: GolfRuntime, now: number): void {
  let deltaMs = now - runtime.lastTickAt;
  runtime.lastTickAt = now;
  if (deltaMs < 0) {
    deltaMs = 0;
  }
  if (deltaMs > GOLF_SERVER_CONSTANTS.MAX_CATCH_UP_MS) {
    deltaMs = GOLF_SERVER_CONSTANTS.MAX_CATCH_UP_MS;
  }
  runtime.simAccumMs += deltaMs;
  while (runtime.simAccumMs >= GOLF_SERVER_CONSTANTS.SIMULATION_STEP_MS) {
    simulateStep(runtime, GOLF_SERVER_CONSTANTS.SIMULATION_STEP_MS, now);
    runtime.simAccumMs -= GOLF_SERVER_CONSTANTS.SIMULATION_STEP_MS;
    if (runtime.phase !== "simulating") {
      runtime.simAccumMs = 0;
      break;
    }
  }
}

function simulateStep(runtime: GolfRuntime, stepMs: number, now: number): void {
  const previous = new Map<string, { x: number; y: number }>();
  for (const [sessionId, player] of runtime.players) {
    if (!player.removed && !player.finished) {
      previous.set(sessionId, { x: player.x, y: player.y });
    }
  }

  stepPhysics(
    runtime.players,
    runtime.roundCourse,
    GOLF_SERVER_CONSTANTS,
    stepMs / 1000,
    (player) => collisionImmune(player, now),
  );

  const finishes: Array<{
    player: RuntimePlayer;
    point: { x: number; y: number };
    t: number;
  }> = [];
  for (const player of runtime.players.values()) {
    if (player.removed || player.finished) {
      continue;
    }
    const before = previous.get(player.sessionId);
    if (before) {
      checkProgressGates(runtime, player, before);
      if (player.latestGateIndex >= runtime.course.progressGates.length - 1) {
        const crossing = crossesSegment(
          before,
          { x: player.x, y: player.y },
          runtime.course.finishLine,
          {
            x: runtime.course.finishLine.validDirectionX,
            y: runtime.course.finishLine.validDirectionY,
          },
        );
        if (crossing) {
          finishes.push({ player, point: crossing.point, t: crossing.t });
        }
      }
    }
  }
  finishes.sort((a, b) => a.t - b.t || a.player.joinedOrder - b.player.joinedOrder);
  for (const finish of finishes) {
    finishPlayer(runtime, finish.player, finish.point);
  }

  for (const player of runtime.players.values()) {
    if (player.removed || player.finished) {
      continue;
    }
    if (isInHazard(runtime.roundCourse, player)) {
      respawnPlayer(runtime, player, now);
    }
  }

  for (const player of runtime.players.values()) {
    if (player.removed || player.finished) {
      continue;
    }
    const speed = speedOf(player);
    if (speed > GOLF_SERVER_CONSTANTS.STOP_SPEED_THRESHOLD) {
      player.moving = true;
      player.stoppedSince = null;
    } else if (player.moving) {
      player.stoppedSince ??= now;
      if (now - player.stoppedSince >= GOLF_SERVER_CONSTANTS.STOP_STABLE_MS) {
        player.moving = false;
        player.stoppedSince = null;
        player.vx = 0;
        player.vy = 0;
      }
    }
    const progress = computeProgress(
      runtime.course,
      runtime.routeDistances,
      { x: player.x, y: player.y },
      player.latestGateIndex,
    );
    player.raceProgress = progress.raceProgress;
    player.sectionProgress = progress.sectionProgress;
  }

  if (allPlayersStopped(runtime)) {
    finishTurn(runtime, now);
  }
}

function checkProgressGates(
  runtime: GolfRuntime,
  player: RuntimePlayer,
  before: { x: number; y: number },
): void {
  let nextIndex = player.latestGateIndex + 1;
  while (nextIndex < runtime.course.progressGates.length) {
    const gate = runtime.course.progressGates[nextIndex];
    if (!gate) {
      break;
    }
    const crossing = crossesSegment(before, { x: player.x, y: player.y }, gate, {
      x: gate.validDirectionX,
      y: gate.validDirectionY,
    });
    if (!crossing) {
      break;
    }
    player.latestGateIndex = nextIndex;
    nextIndex += 1;
  }
}

function finishPlayer(
  runtime: GolfRuntime,
  player: RuntimePlayer,
  point: { x: number; y: number },
): void {
  player.finished = true;
  runtime.finishOrder += 1;
  player.finishedRank = runtime.finishOrder;
  player.x = point.x;
  player.y = point.y;
  player.vx = 0;
  player.vy = 0;
  player.moving = false;
  player.stoppedSince = null;
  const progress = computeProgress(
    runtime.course,
    runtime.routeDistances,
    { x: player.x, y: player.y },
    player.latestGateIndex,
  );
  player.raceProgress = progress.raceProgress;
  player.sectionProgress = progress.sectionProgress;
}

function isInHazard(course: GolfCourse, player: RuntimePlayer): boolean {
  return course.hazards.some((hazard) => isInsideHazard({ x: player.x, y: player.y }, hazard));
}

function respawnPlayer(runtime: GolfRuntime, player: RuntimePlayer, now: number): void {
  const crossedGates = player.latestGateIndex + 1;
  const respawns = runtime.course.respawnPositions
    .filter((position) => position.unlockedAfterGateCount <= crossedGates)
    .sort((a, b) => b.unlockedAfterGateCount - a.unlockedAfterGateCount);
  const preferred = respawns[0] ?? runtime.course.respawnPositions[0];
  if (!preferred) {
    throw new Error(`Golf course ${runtime.course.id}: no respawn positions`);
  }
  const placement = findFreePlacement(runtime, player, preferred.x, preferred.y);
  player.x = placement.x;
  player.y = placement.y;
  player.vx = 0;
  player.vy = 0;
  player.moving = false;
  player.stoppedSince = null;
  player.collisionImmunityUntil = now + runtime.settings.immunityMs;
  player.protectedNextTurn = true;
  const progress = computeProgress(
    runtime.course,
    runtime.routeDistances,
    { x: player.x, y: player.y },
    player.latestGateIndex,
  );
  player.raceProgress = progress.raceProgress;
  player.sectionProgress = progress.sectionProgress;
}

function findFreePlacement(
  runtime: GolfRuntime,
  player: RuntimePlayer,
  preferredX: number,
  preferredY: number,
): { x: number; y: number } {
  const radius = GOLF_SERVER_CONSTANTS.BALL_RADIUS;
  const candidates: Array<{ x: number; y: number }> = [{ x: preferredX, y: preferredY }];
  for (let ring = 1; ring <= 40; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
          continue;
        }
        candidates.push({ x: preferredX + dx * radius, y: preferredY + dy * radius });
      }
    }
  }
  for (const candidate of candidates) {
    if (isValidPlacement(runtime, player, candidate)) {
      return candidate;
    }
  }
  return { x: preferredX, y: preferredY };
}

function isValidPlacement(
  runtime: GolfRuntime,
  player: RuntimePlayer,
  point: { x: number; y: number },
): boolean {
  const radius = GOLF_SERVER_CONSTANTS.BALL_RADIUS;
  if (
    point.x < radius ||
    point.x > runtime.roundCourse.world.width - radius ||
    point.y < radius ||
    point.y > runtime.roundCourse.world.height - radius
  ) {
    return false;
  }
  if (pointInsideHazardForPlacement(point, runtime.roundCourse, radius)) {
    return false;
  }
  if (
    runtime.roundCourse.walls.some((wall) => distanceToSegmentForPlacement(point, wall) < radius) ||
    runtime.roundCourse.obstacles.some(
      (obstacle) => distanceToObstacleForPlacement(point, obstacle) < radius,
    )
  ) {
    return false;
  }
  for (const other of runtime.players.values()) {
    if (other.sessionId === player.sessionId || other.removed || other.finished) {
      continue;
    }
    if (Math.hypot(other.x - point.x, other.y - point.y) < radius * 2) {
      return false;
    }
  }
  return true;
}

function distanceToSegmentForPlacement(
  point: { x: number; y: number },
  segment: { x1: number; y1: number; x2: number; y2: number },
): number {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / lengthSquared),
        );
  const closestX = segment.x1 + t * dx;
  const closestY = segment.y1 + t * dy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function distanceToObstacleForPlacement(
  point: { x: number; y: number },
  obstacle: GolfCourse["obstacles"][number],
): number {
  if (obstacle.kind === "circle") {
    return Math.hypot(point.x - obstacle.x, point.y - obstacle.y) - obstacle.radius;
  }
  const closestX = Math.max(obstacle.x, Math.min(point.x, obstacle.x + obstacle.width));
  const closestY = Math.max(obstacle.y, Math.min(point.y, obstacle.y + obstacle.height));
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function allPlayersStopped(runtime: GolfRuntime): boolean {
  for (const player of currentRoundParticipants(runtime)) {
    if (!player.finished && player.moving) {
      return false;
    }
  }
  return true;
}

function currentRoundParticipants(runtime: GolfRuntime): RuntimePlayer[] {
  return [...runtime.players.values()].filter((player) => !player.removed);
}

function clearTurnImmunity(player: RuntimePlayer): void {
  player.collisionImmunityUntil = 0;
  player.protectedNextTurn = false;
}

export function collisionImmune(player: RuntimePlayer, now: number): boolean {
  return player.collisionImmunityUntil > now || player.protectedNextTurn;
}

export function finishMatch(runtime: GolfRuntime): void {
  runtime.phase = "finished";
  runtime.aimingEndsAt = 0;
  runtime.resultsEndsAt = 0;
  runtime.roundEndsAt = 0;
  runtime.currentTurnSessionId = "";
  runtime.result = buildResult(runtime);
}

function buildResult(runtime: GolfRuntime): GolfResult {
  const ordered = [...runtime.players.values()].sort(
    (a, b) =>
      b.matchPoints - a.matchPoints || b.roundWins - a.roundWins || a.joinedOrder - b.joinedOrder,
  );
  const entries: GolfLeaderboardEntry[] = [];
  for (const [index, player] of ordered.entries()) {
    const previous = ordered[index - 1];
    const previousEntry = entries[index - 1];
    const rank =
      previous !== undefined && previous.matchPoints === player.matchPoints
        ? (previousEntry?.rank ?? index + 1)
        : index + 1;
    entries.push({
      sessionId: player.sessionId,
      rank,
      finishOrder: index + 1,
      primaryScore: player.matchPoints,
      roundWins: player.roundWins,
      label: player.name,
    });
  }
  const winningScore = entries[0]?.primaryScore;
  const winnerSessionIds = entries
    .filter((entry) => winningScore !== undefined && entry.primaryScore === winningScore)
    .map((entry) => entry.sessionId);
  return { winnerSessionIds, leaderboard: entries };
}
