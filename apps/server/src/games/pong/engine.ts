import {
  PONG_CONSTANTS,
  type PongRect,
  type PongWorldEdge,
  paddleRect,
} from "@phone-party/protocol";

import { PONG_SERVER_CONSTANTS, playerColorFor } from "./constants.js";
import { buildPongSlots, shuffledPongSlots } from "./layout.js";
import { createMatchRng, createMatchSeed } from "./rng.js";
import type {
  PongMatchResult,
  PongRuntime,
  PongSettings,
  RuntimeBall,
  RuntimePlayer,
} from "./types.js";

export function buildSettings(input: { e2eMode: boolean }): PongSettings {
  const config = PONG_SERVER_CONSTANTS;
  return {
    config,
    e2eMode: input.e2eMode,
    countdownMs: input.e2eMode ? config.E2E_COUNTDOWN_MS : config.COUNTDOWN_MS,
    spawnWarningMs: input.e2eMode ? config.E2E_SPAWN_WARNING_MS : config.SPAWN_WARNING_MS,
    escalationIntervalMs: input.e2eMode
      ? config.E2E_ESCALATION_INTERVAL_MS
      : config.ESCALATION_INTERVAL_MS,
    ballSpeed: input.e2eMode ? config.E2E_BALL_SPEED : config.BALL_SPEED,
    paddleCrossTimeSeconds: input.e2eMode
      ? config.E2E_PADDLE_CROSS_TIME_SECONDS
      : config.PADDLE_CROSS_TIME_SECONDS,
    spawnRadius: input.e2eMode ? config.E2E_SPAWN_RADIUS : 80,
  };
}

export function createRuntime(settings: PongSettings): PongRuntime {
  return {
    phase: "lobby",
    countdownEndsAt: 0,
    matchStartedAt: 0,
    matchElapsedMs: 0,
    ballSpeed: 0,
    paddleSpeed: 0,
    desiredBallCount: 0,
    maxBallCount: 0,
    lastGoalDefenderSessionId: "",
    lastGoalScorerSessionId: "",
    lastGoalAt: 0,
    nextBallId: 1,
    seed: "",
    rng: () => 0,
    lastTickAt: 0,
    simAccumMs: 0,
    players: new Map(),
    balls: new Map(),
    settings,
    result: null,
  };
}

export function addPlayer(
  runtime: PongRuntime,
  sessionId: string,
  name: string,
  joinedOrder: number,
): RuntimePlayer {
  const player: RuntimePlayer = {
    sessionId,
    name,
    connected: true,
    joinedOrder,
    color: "",
    worldEdge: "bottom",
    slotIndex: 0,
    openingStart: 0,
    openingEnd: 0,
    paddleMin: 0,
    paddleMax: 0,
    paddleLength: 0,
    paddleCenter: 0,
    queuedTarget: null,
    lastAcceptedSequence: 0,
    seenSequences: new Set(),
    score: 0,
  };
  runtime.players.set(sessionId, player);
  return player;
}

/**
 * Starts the countdown for a new match. Player-to-slot assignments, the
 * asymmetric layout rotation, colours, and the first ball are all drawn from
 * the seeded match RNG. Returns false when fewer than the minimum number of
 * players are connected.
 */
export function startMatch(runtime: PongRuntime, now: number): boolean {
  const participants = [...runtime.players.values()]
    .filter((player) => player.connected)
    .sort((a, b) => a.joinedOrder - b.joinedOrder);
  if (participants.length < PONG_CONSTANTS.MIN_PLAYERS) {
    return false;
  }

  runtime.seed = createMatchSeed(runtime.settings.e2eMode);
  runtime.rng = createMatchRng(runtime.seed);
  const slots =
    runtime.settings.e2eMode && participants.length === 2
      ? [...buildPongSlots(2, runtime.rng)].reverse()
      : shuffledPongSlots(participants.length, runtime.rng);
  participants.forEach((player, index) => {
    const slot = slots[index];
    if (!slot) {
      throw new Error("Pong layout has fewer slots than players");
    }
    player.color = playerColorFor(index);
    player.worldEdge = slot.worldEdge;
    player.slotIndex = slot.slotIndex;
    player.openingStart = slot.openingStart;
    player.openingEnd = slot.openingEnd;
    player.paddleMin = slot.paddleMin;
    player.paddleMax = slot.paddleMax;
    player.paddleLength = slot.paddleLength;
    player.paddleCenter = (slot.paddleMin + slot.paddleMax) / 2;
    player.queuedTarget = null;
    player.lastAcceptedSequence = 0;
    player.seenSequences.clear();
    player.score = 0;
  });
  for (const player of runtime.players.values()) {
    if (!player.connected) {
      player.queuedTarget = null;
      player.score = 0;
    }
  }

  runtime.phase = "countdown";
  runtime.countdownEndsAt = now + runtime.settings.countdownMs;
  runtime.matchStartedAt = 0;
  runtime.matchElapsedMs = 0;
  runtime.ballSpeed = runtime.settings.ballSpeed;
  const travel = participants[0] ? participants[0].paddleMax - participants[0].paddleMin : 0;
  runtime.paddleSpeed = Math.max(1, travel / runtime.settings.paddleCrossTimeSeconds);
  runtime.desiredBallCount = 1;
  runtime.maxBallCount =
    PONG_SERVER_CONSTANTS.MAX_BALLS_BY_PLAYERS[participants.length as 2 | 3 | 4 | 5 | 6 | 7 | 8];
  runtime.lastGoalDefenderSessionId = "";
  runtime.lastGoalScorerSessionId = "";
  runtime.lastGoalAt = 0;
  runtime.nextBallId = 1;
  runtime.balls.clear();
  runtime.result = null;
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
  addWarningBall(runtime, runtime.countdownEndsAt);
  return true;
}

export function beginRunning(runtime: PongRuntime, now: number): void {
  runtime.phase = "running";
  runtime.matchStartedAt = now;
  runtime.matchElapsedMs = 0;
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
  launchDueBalls(runtime, now);
}

/** Applies a validated paddle intent. The room owns sequence and rate checks. */
export function applyPaddleIntent(
  player: RuntimePlayer,
  intent: { type: "paddle_move"; target: number } | { type: "paddle_stop" },
  sequence: number,
): void {
  player.lastAcceptedSequence = Math.max(player.lastAcceptedSequence, sequence);
  player.seenSequences.add(sequence);
  for (const seen of [...player.seenSequences]) {
    if (seen < player.lastAcceptedSequence - PONG_SERVER_CONSTANTS.SEQUENCE_WINDOW) {
      player.seenSequences.delete(seen);
    }
  }
  player.queuedTarget = intent.type === "paddle_move" ? intent.target : null;
}

/**
 * Advances the authoritative simulation. The room calls this on its interval
 * and then projects the runtime onto the synchronized schema. Keeping the
 * loop outside the room makes phase transitions, collisions, scoring,
 * escalation, and the final result testable without networking.
 */
export function updatePong(runtime: PongRuntime, now: number): void {
  if (runtime.phase === "countdown" && now >= runtime.countdownEndsAt) {
    beginRunning(runtime, now);
  }
  if (runtime.phase !== "countdown" && runtime.phase !== "running") {
    return;
  }

  let dt = now - runtime.lastTickAt;
  runtime.lastTickAt = now;
  if (dt < 0) {
    dt = 0;
  }
  if (dt > PONG_SERVER_CONSTANTS.MAX_CATCH_UP_MS) {
    dt = PONG_SERVER_CONSTANTS.MAX_CATCH_UP_MS;
  }
  runtime.simAccumMs += dt;
  while (runtime.simAccumMs >= PONG_SERVER_CONSTANTS.SIMULATION_STEP_MS) {
    simulateStep(runtime, PONG_SERVER_CONSTANTS.SIMULATION_STEP_MS, now);
    runtime.simAccumMs -= PONG_SERVER_CONSTANTS.SIMULATION_STEP_MS;
    if (runtime.phase !== "countdown" && runtime.phase !== "running") {
      runtime.simAccumMs = 0;
      break;
    }
  }

  if (runtime.phase === "running") {
    runtime.matchElapsedMs = Math.max(0, now - runtime.matchStartedAt);
    launchDueBalls(runtime, now);
    updateEscalation(runtime, now);
  }
}

/** Returns everyone to the game-room lobby and clears all match state. */
export function returnToLobby(runtime: PongRuntime): void {
  runtime.phase = "lobby";
  runtime.countdownEndsAt = 0;
  runtime.matchStartedAt = 0;
  runtime.matchElapsedMs = 0;
  runtime.ballSpeed = 0;
  runtime.paddleSpeed = 0;
  runtime.desiredBallCount = 0;
  runtime.maxBallCount = 0;
  runtime.lastGoalDefenderSessionId = "";
  runtime.lastGoalScorerSessionId = "";
  runtime.lastGoalAt = 0;
  runtime.nextBallId = 1;
  runtime.lastTickAt = 0;
  runtime.simAccumMs = 0;
  runtime.balls.clear();
  runtime.result = null;

  for (const player of runtime.players.values()) {
    player.queuedTarget = null;
    player.lastAcceptedSequence = 0;
    player.seenSequences.clear();
    player.score = 0;
  }
}

/** Clears the completed match so Play again starts a fresh race to 10. */
export function resetForNewMatch(runtime: PongRuntime): void {
  returnToLobby(runtime);
}

/** Removes a permanently departed player; the match keeps its layout. */
export function removePlayer(runtime: PongRuntime, sessionId: string): void {
  runtime.players.delete(sessionId);
}

export function hasConnectedPlayers(runtime: PongRuntime): boolean {
  return [...runtime.players.values()].some((player) => player.connected);
}

function simulateStep(runtime: PongRuntime, stepMs: number, now: number): void {
  movePaddles(runtime, stepMs);
  if (runtime.phase !== "running") {
    return;
  }

  const goals: Array<{
    ballId: string;
    defenderSessionId: string;
    ownerSessionId: string;
  }> = [];
  for (const ball of runtime.balls.values()) {
    if (ball.state !== "moving") {
      continue;
    }
    stepBall(runtime, ball, stepMs, goals);
  }

  for (const goal of goals) {
    runtime.balls.delete(goal.ballId);
    runtime.lastGoalDefenderSessionId = goal.defenderSessionId;
    const awarded = goal.ownerSessionId !== "" && goal.ownerSessionId !== goal.defenderSessionId;
    runtime.lastGoalScorerSessionId = awarded ? goal.ownerSessionId : "";
    runtime.lastGoalAt = now;
    if (awarded) {
      const scorer = runtime.players.get(goal.ownerSessionId);
      if (scorer) {
        scorer.score += 1;
      }
    }
    addWarningBall(runtime, now + runtime.settings.spawnWarningMs);
  }

  evaluateWin(runtime);
}

function movePaddles(runtime: PongRuntime, stepMs: number): void {
  const step = stepMs / 1000;
  for (const player of runtime.players.values()) {
    if (!player.connected || player.queuedTarget === null) {
      continue;
    }
    const target = player.paddleMin + player.queuedTarget * (player.paddleMax - player.paddleMin);
    const delta = runtime.paddleSpeed * step;
    if (player.paddleCenter < target) {
      player.paddleCenter = Math.min(target, player.paddleCenter + delta);
    } else if (player.paddleCenter > target) {
      player.paddleCenter = Math.max(target, player.paddleCenter - delta);
    }
  }
}

function stepBall(
  runtime: PongRuntime,
  ball: RuntimeBall,
  stepMs: number,
  goals: Array<{ ballId: string; defenderSessionId: string; ownerSessionId: string }>,
): void {
  const dt = stepMs / 1000;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  collideWithCornerBumpers(ball, runtime.ballSpeed);

  const boundary = boundaryCrossing(ball);
  if (boundary !== null) {
    const defender = defenderFor(runtime, boundary.edge, boundary.coord);
    if (defender) {
      goals.push({
        ballId: ball.id,
        defenderSessionId: defender.sessionId,
        ownerSessionId: ball.ownerSessionId,
      });
      return;
    }
    bounceFromBoundary(ball, boundary, runtime.ballSpeed);
  }

  for (const player of runtime.players.values()) {
    if (player.connected && paddleHit(ball, player, runtime.ballSpeed)) {
      ball.ownerSessionId = player.sessionId;
      break;
    }
  }
}

function collideWithCornerBumpers(ball: RuntimeBall, speed: number): void {
  const config = PONG_SERVER_CONSTANTS;
  const bumpers: PongRect[] = [
    { x: 0, y: 0, width: config.CORNER_BUMPER_SIZE, height: config.CORNER_BUMPER_SIZE },
    {
      x: config.WORLD_SIZE - config.CORNER_BUMPER_SIZE,
      y: 0,
      width: config.CORNER_BUMPER_SIZE,
      height: config.CORNER_BUMPER_SIZE,
    },
    {
      x: 0,
      y: config.WORLD_SIZE - config.CORNER_BUMPER_SIZE,
      width: config.CORNER_BUMPER_SIZE,
      height: config.CORNER_BUMPER_SIZE,
    },
    {
      x: config.WORLD_SIZE - config.CORNER_BUMPER_SIZE,
      y: config.WORLD_SIZE - config.CORNER_BUMPER_SIZE,
      width: config.CORNER_BUMPER_SIZE,
      height: config.CORNER_BUMPER_SIZE,
    },
  ];
  for (const bumper of bumpers) {
    if (bounceFromBumper(ball, bumper, speed)) {
      return;
    }
  }
}

function bounceFromBumper(ball: RuntimeBall, bumper: PongRect, speed: number): boolean {
  const closestX = clamp(ball.x, bumper.x, bumper.x + bumper.width);
  const closestY = clamp(ball.y, bumper.y, bumper.y + bumper.height);
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  const distanceSquared = dx * dx + dy * dy;
  const radius = PONG_SERVER_CONSTANTS.BALL_RADIUS;
  if (distanceSquared > radius * radius) {
    return false;
  }
  if (distanceSquared === 0) {
    // The ball centre landed exactly on a bumper corner: push it back into
    // the arena along a deterministic direction instead of dividing by zero.
    ball.vx = -ball.vx;
    ball.vy = -ball.vy;
    ball.x = bumper.x - radius - 0.01;
    ball.y = bumper.y - radius - 0.01;
    const [vx, vy] = clampDirection(ball.vx, ball.vy);
    ball.vx = vx * speed;
    ball.vy = vy * speed;
    return true;
  }

  const insideX = ball.x >= bumper.x && ball.x <= bumper.x + bumper.width;
  const insideY = ball.y >= bumper.y && ball.y <= bumper.y + bumper.height;
  if (!insideX) {
    ball.vx = -ball.vx;
  }
  if (!insideY) {
    ball.vy = -ball.vy;
  }
  if (insideX && insideY) {
    ball.vx = -ball.vx;
    ball.vy = -ball.vy;
  }
  const distance = Math.sqrt(distanceSquared) || 1;
  ball.x = closestX + (dx / distance) * (radius + 0.01);
  ball.y = closestY + (dy / distance) * (radius + 0.01);
  const [vx, vy] = clampDirection(ball.vx, ball.vy);
  ball.vx = vx * speed;
  ball.vy = vy * speed;
  return true;
}

function boundaryCrossing(ball: RuntimeBall): { edge: PongWorldEdge; coord: number } | null {
  const size = PONG_SERVER_CONSTANTS.WORLD_SIZE;
  if (ball.x < 0) {
    return { edge: "left", coord: ball.y };
  }
  if (ball.x > size) {
    return { edge: "right", coord: ball.y };
  }
  if (ball.y < 0) {
    return { edge: "top", coord: ball.x };
  }
  if (ball.y > size) {
    return { edge: "bottom", coord: ball.x };
  }
  return null;
}

function defenderFor(
  runtime: PongRuntime,
  edge: PongWorldEdge,
  coord: number,
): RuntimePlayer | null {
  for (const player of runtime.players.values()) {
    if (player.worldEdge === edge && coord >= player.openingStart && coord <= player.openingEnd) {
      return player;
    }
  }
  return null;
}

function bounceFromBoundary(
  ball: RuntimeBall,
  boundary: { edge: PongWorldEdge; coord: number },
  speed: number,
): void {
  const size = PONG_SERVER_CONSTANTS.WORLD_SIZE;
  switch (boundary.edge) {
    case "left":
      ball.x = -ball.x;
      ball.vx = -ball.vx;
      break;
    case "right":
      ball.x = 2 * size - ball.x;
      ball.vx = -ball.vx;
      break;
    case "top":
      ball.y = -ball.y;
      ball.vy = -ball.vy;
      break;
    case "bottom":
      ball.y = 2 * size - ball.y;
      ball.vy = -ball.vy;
      break;
  }
  const [vx, vy] = clampDirection(ball.vx, ball.vy);
  ball.vx = vx * speed;
  ball.vy = vy * speed;
}

function paddleHit(ball: RuntimeBall, player: RuntimePlayer, speed: number): boolean {
  const rect = paddleRect({
    worldEdge: player.worldEdge,
    paddleCenter: player.paddleCenter,
    paddleLength: player.paddleLength,
  });
  const closestX = clamp(ball.x, rect.x, rect.x + rect.width);
  const closestY = clamp(ball.y, rect.y, rect.y + rect.height);
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  const radius = PONG_SERVER_CONSTANTS.BALL_RADIUS;
  if (dx * dx + dy * dy > radius * radius) {
    return false;
  }

  // Collide when the ball is moving toward the paddle. Checking the side
  // alone lets a fast ball tunnel through the paddle between steps; checking
  // the velocity keeps the collision swept and prevents a ball that has
  // already crossed the goal line from being rescued.
  switch (player.worldEdge) {
    case "top":
      if (ball.vy >= 0) {
        return false;
      }
      break;
    case "bottom":
      if (ball.vy <= 0) {
        return false;
      }
      break;
    case "left":
      if (ball.vx >= 0) {
        return false;
      }
      break;
    case "right":
      if (ball.vx <= 0) {
        return false;
      }
      break;
  }

  const along = player.worldEdge === "top" || player.worldEdge === "bottom" ? ball.x : ball.y;
  const offset = clamp((along - player.paddleCenter) / (player.paddleLength / 2), -1, 1);
  const maxDegrees = PONG_SERVER_CONSTANTS.MAX_DEFLECTION_DEGREES;
  const minDegrees = PONG_SERVER_CONSTANTS.MIN_DEFLECTION_DEGREES;
  let angleDegrees = offset * maxDegrees;
  if (Math.abs(angleDegrees) < minDegrees) {
    const tangentialVelocity =
      player.worldEdge === "top" || player.worldEdge === "bottom" ? ball.vx : ball.vy;
    const sign = tangentialVelocity < 0 ? -1 : 1;
    angleDegrees = minDegrees * sign;
  }

  const normal = inwardNormal(player.worldEdge);
  const tangent = localRight(player.worldEdge);
  const radians = (angleDegrees * Math.PI) / 180;
  let vx = normal.x + tangent.x * Math.tan(radians);
  let vy = normal.y + tangent.y * Math.tan(radians);
  const length = Math.hypot(vx, vy) || 1;
  vx /= length;
  vy /= length;
  const [clampedX, clampedY] = clampDirection(vx, vy);
  ball.vx = clampedX * speed;
  ball.vy = clampedY * speed;

  // Push the ball out along the inward normal so it cannot stick to the
  // paddle and re-collide on the next simulation step.
  switch (player.worldEdge) {
    case "top":
      ball.y = rect.y + rect.height + radius + 0.01;
      break;
    case "bottom":
      ball.y = rect.y - radius - 0.01;
      break;
    case "left":
      ball.x = rect.x + rect.width + radius + 0.01;
      break;
    case "right":
      ball.x = rect.x - radius - 0.01;
      break;
  }
  return true;
}

function inwardNormal(edge: PongWorldEdge): { x: number; y: number } {
  switch (edge) {
    case "top":
      return { x: 0, y: 1 };
    case "bottom":
      return { x: 0, y: -1 };
    case "left":
      return { x: 1, y: 0 };
    case "right":
      return { x: -1, y: 0 };
  }
}

/** Local "right" for a player: the counterclockwise direction around the arena. */
function localRight(edge: PongWorldEdge): { x: number; y: number } {
  switch (edge) {
    case "top":
      return { x: 1, y: 0 };
    case "right":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: -1, y: 0 };
    case "left":
      return { x: 0, y: 1 };
  }
}

function updateEscalation(runtime: PongRuntime, now: number): void {
  const elapsed = Math.max(0, runtime.matchElapsedMs);
  const desired = Math.min(
    Math.max(1, runtime.maxBallCount),
    1 + Math.floor(elapsed / runtime.settings.escalationIntervalMs),
  );
  runtime.desiredBallCount = desired;
  while (runtime.balls.size < desired) {
    addWarningBall(runtime, now + runtime.settings.spawnWarningMs);
  }
}

function addWarningBall(runtime: PongRuntime, spawnsAt: number): void {
  const config = PONG_SERVER_CONSTANTS;
  const ball: RuntimeBall = {
    id: `ball-${runtime.nextBallId}`,
    x: config.WORLD_SIZE / 2,
    y: config.WORLD_SIZE / 2,
    vx: 0,
    vy: 0,
    ownerSessionId: "",
    state: "warning",
    spawnsAt,
  };
  const [unitX, unitY] = runtime.settings.e2eMode
    ? clampDirection(-0.3, 1)
    : randomDirection(runtime.rng);
  ball.vx = unitX;
  ball.vy = unitY;
  if (runtime.settings.e2eMode) {
    // Deterministic E2E launch: the ball reaches the centred defender paddle
    // and its return lands outside the opponent's paddle, so a full match
    // finishes quickly and reproducibly without relying on client input.
    ball.x = config.WORLD_SIZE / 2 + 92;
    ball.y = config.WORLD_SIZE / 2;
  } else {
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = config.WORLD_SIZE / 2 + (runtime.rng() * 2 - 1) * runtime.settings.spawnRadius;
      const y = config.WORLD_SIZE / 2 + (runtime.rng() * 2 - 1) * runtime.settings.spawnRadius;
      if (!overlapsPendingBall(runtime, x, y)) {
        ball.x = x;
        ball.y = y;
        break;
      }
    }
  }
  runtime.nextBallId += 1;
  runtime.balls.set(ball.id, ball);
}

function overlapsPendingBall(runtime: PongRuntime, x: number, y: number): boolean {
  for (const ball of runtime.balls.values()) {
    if (ball.state !== "warning") {
      continue;
    }
    const dx = ball.x - x;
    const dy = ball.y - y;
    if (dx * dx + dy * dy < 70 * 70) {
      return true;
    }
  }
  return false;
}

function launchDueBalls(runtime: PongRuntime, now: number): void {
  for (const ball of runtime.balls.values()) {
    if (ball.state === "warning" && now >= ball.spawnsAt) {
      ball.state = "moving";
      ball.spawnsAt = 0;
      ball.vx *= runtime.ballSpeed;
      ball.vy *= runtime.ballSpeed;
    }
  }
}

function evaluateWin(runtime: PongRuntime): void {
  let finished = false;
  for (const player of runtime.players.values()) {
    if (player.score >= PONG_SERVER_CONSTANTS.TARGET_SCORE) {
      finished = true;
      break;
    }
  }
  if (!finished) {
    return;
  }
  runtime.phase = "finished";
  runtime.result = buildPongResult(runtime);
  for (const player of runtime.players.values()) {
    player.queuedTarget = null;
  }
}

export function buildPongResult(runtime: PongRuntime): PongMatchResult {
  const ordered = [...runtime.players.values()].sort(
    (a, b) => b.score - a.score || a.joinedOrder - b.joinedOrder,
  );
  const leaderboard = ordered.map((player, index) => ({
    sessionId: player.sessionId,
    rank: index + 1,
    score: player.score,
    label: player.name,
  }));
  // Competition ranking: equal scores share a rank; the next rank skips.
  for (let index = 1; index < leaderboard.length; index++) {
    const previous = leaderboard[index - 1];
    const current = leaderboard[index];
    if (previous && current && current.score === previous.score) {
      current.rank = previous.rank;
    }
  }
  return {
    winnerSessionIds: ordered
      .filter((player) => player.score >= PONG_SERVER_CONSTANTS.TARGET_SCORE)
      .map((player) => player.sessionId),
    leaderboard,
  };
}

/** Normalizes a direction and keeps both axes above the minimum component. */
export function clampDirection(
  vx: number,
  vy: number,
  minComponent = PONG_SERVER_CONSTANTS.MIN_DIRECTION_COMPONENT,
): [number, number] {
  const rawAngle = Math.atan2(vy, vx);
  let angle = (rawAngle + Math.PI * 2) % (Math.PI * 2);
  const quadrant = Math.floor(angle / (Math.PI / 2));
  const withinQuadrant = angle - quadrant * (Math.PI / 2);
  const minAngle = Math.asin(minComponent);
  if (withinQuadrant < minAngle) {
    angle = quadrant * (Math.PI / 2) + minAngle;
  } else if (withinQuadrant > Math.PI / 2 - minAngle) {
    angle = (quadrant + 1) * (Math.PI / 2) - minAngle;
  }
  return [Math.cos(angle), Math.sin(angle)];
}

function randomDirection(rng: () => number): [number, number] {
  const angle = rng() * Math.PI * 2;
  return clampDirection(Math.cos(angle), Math.sin(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
