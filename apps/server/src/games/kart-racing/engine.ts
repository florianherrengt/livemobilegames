import {
  crossesCheckpointBackward,
  crossesCheckpointForward,
  KART_RACING_POINTS,
  type TrackPoint,
} from "@phone-party/protocol";

import type { KART_RACING_SERVER_CONSTANTS } from "./constants.js";
import { beginRunning, playerProgress, prepareRace } from "./runtime.js";
import { buildKartRacingResult } from "./scoring.js";
import {
  angleDifference,
  checkpointForGate,
  gateCenterlineIndex,
  isInFallZone,
  isInSlowZone,
  nearestObstacleHit,
  nearestWallHit,
  normalizeAngle,
  safeRespawnPoint,
} from "./track.js";
import type { KartRacingRuntime, RuntimePlayer, RuntimeProjectile } from "./types.js";

/**
 * Advances the authoritative Kart Racing simulation by one server tick. The
 * Colyseus room calls this on its interval and then projects the runtime onto
 * the synchronized schema. Keeping the loop outside the room makes movement,
 * collisions, falling, checkpoints, race endings, and the final result
 * testable without networking.
 */
export function updateRuntime(runtime: KartRacingRuntime, now: number): void {
  if (runtime.phase === "countdown") {
    runtime.lastTickAt = now;
    if (now >= runtime.countdownEndsAt) {
      beginRunning(runtime, now);
    }
  } else if (runtime.phase === "racing") {
    advanceSimulation(runtime, now);
    if (runtime.raceFinishTimeoutEndsAt > 0 && now >= runtime.raceFinishTimeoutEndsAt) {
      endRace(runtime, now);
    }
  } else if (runtime.phase === "race-result" && now >= runtime.resultsEndsAt) {
    if (runtime.raceNumber < runtime.totalRaces) {
      prepareRace(runtime, now, runtime.raceNumber + 1);
    } else {
      finishMatch(runtime);
    }
  }
}

function advanceSimulation(runtime: KartRacingRuntime, now: number): void {
  let dt = now - runtime.lastTickAt;
  runtime.lastTickAt = now;
  if (dt < 0) {
    dt = 0;
  }
  const config = runtime.settings.config;
  if (dt > config.MAX_CATCH_UP_MS) {
    dt = config.MAX_CATCH_UP_MS;
  }
  runtime.simAccumMs += dt;
  while (runtime.simAccumMs >= config.SIMULATION_STEP_MS) {
    simulateStep(runtime, config.SIMULATION_STEP_MS, now);
    runtime.simAccumMs -= config.SIMULATION_STEP_MS;
    if (runtime.phase !== "racing") {
      runtime.simAccumMs = 0;
      break;
    }
  }
}

function simulateStep(runtime: KartRacingRuntime, stepMs: number, now: number): void {
  resolveRespawns(runtime, now);
  moveKarts(runtime, stepMs, now);
  resolveWorldCollisions(runtime);
  handleFalling(runtime, now);
  handleCheckpoints(runtime, now);
  handleCrateCollection(runtime);
  updateProjectiles(runtime, stepMs, now);
  resolveKartCollisions(runtime, now);
  updateRacePositions(runtime);
  const participantCount = [...runtime.players.values()].filter((player) => !player.removed).length;
  if (participantCount > 0 && runtime.raceFinishOrder.length >= participantCount) {
    endRace(runtime, now);
  }
}

/**
 * Stops or redirects karts against the track's outer walls and static
 * obstacles. The kart is pushed back outside the solid geometry, its speed is
 * reduced, and its heading is reflected when it was moving into the surface.
 */
function resolveWorldCollisions(runtime: KartRacingRuntime): void {
  const config = runtime.settings.config;
  for (const player of runtime.players.values()) {
    if (!player.active || !player.connected || player.removed || player.finished) {
      continue;
    }
    const wall = nearestWallHit(runtime.track, player.x, player.y, config.KART_RADIUS);
    if (wall !== null) {
      const radius = config.KART_RADIUS + config.WALL_RADIUS;
      player.x = wall.x + wall.nx * radius;
      player.y = wall.y + wall.ny * radius;
      applySurfaceImpact(player, wall.nx, wall.ny, config.WALL_SLOWDOWN);
      player.prevX = player.x;
      player.prevY = player.y;
      continue;
    }
    const obstacle = nearestObstacleHit(runtime.track, player.x, player.y, config.KART_RADIUS);
    if (obstacle !== null) {
      const radius = config.KART_RADIUS + obstacle.radius;
      player.x = obstacle.x + obstacle.nx * radius;
      player.y = obstacle.y + obstacle.ny * radius;
      applySurfaceImpact(player, obstacle.nx, obstacle.ny, config.WALL_SLOWDOWN);
      player.prevX = player.x;
      player.prevY = player.y;
    }
  }
}

function applySurfaceImpact(player: RuntimePlayer, nx: number, ny: number, slowdown: number): void {
  const vx = Math.cos(player.heading) * player.speed;
  const vy = Math.sin(player.heading) * player.speed;
  const intoSurface = vx * nx + vy * ny;
  if (intoSurface < 0) {
    const rx = vx - 2 * intoSurface * nx;
    const ry = vy - 2 * intoSurface * ny;
    const reflectedSpeed = Math.hypot(rx, ry) * slowdown;
    player.speed = reflectedSpeed;
    player.heading = Math.atan2(ry, rx);
  } else {
    player.speed *= slowdown;
  }
}

function resolveRespawns(runtime: KartRacingRuntime, now: number): void {
  for (const player of runtime.players.values()) {
    if (!player.connected || player.respawnUntil <= 0 || now < player.respawnUntil) {
      continue;
    }
    const point = player.respawnPoint;
    if (point !== null) {
      player.x = point.x;
      player.y = point.y;
      player.prevX = point.x;
      player.prevY = point.y;
      player.heading = player.respawnHeading;
    }
    player.speed = 0;
    player.active = player.connected && !player.removed && !player.finished;
    player.respawnUntil = 0;
    player.respawnImmunityUntil = now + runtime.settings.config.RESPAWN_IMMUNITY_MS;
    player.hitStopUntil = 0;
    player.immunityUntil = 0;
  }
}

function moveKarts(runtime: KartRacingRuntime, stepMs: number, now: number): void {
  const config = runtime.settings.config;
  const dt = stepMs / 1000;
  for (const player of runtime.players.values()) {
    if (!player.active || !player.connected || player.removed || player.finished) {
      continue;
    }

    if (player.hitStopUntil > now) {
      // A stopped kart may rotate slightly through steering but cannot drive.
      player.steering += (player.targetSteering - player.steering) * Math.min(1, 8 * dt);
      player.heading += player.steering * runtime.settings.steeringStrength * 0.3 * dt;
      player.speed = 0;
      continue;
    }

    const slow = isInSlowZone(runtime.track, player.x, player.y);
    const maxSpeed = runtime.settings.maxSpeed * (slow ? config.SLOW_TERRAIN_SPEED_MULTIPLIER : 1);
    player.speed = Math.min(maxSpeed, player.speed + runtime.settings.acceleration * dt);
    player.steering += (player.targetSteering - player.steering) * Math.min(1, 8 * dt);
    const steeringFactor =
      1 - config.HIGH_SPEED_STEERING_REDUCTION * (player.speed / runtime.settings.maxSpeed);
    player.heading += player.steering * runtime.settings.steeringStrength * steeringFactor * dt;
    player.prevX = player.x;
    player.prevY = player.y;
    player.x += Math.cos(player.heading) * player.speed * dt;
    player.y += Math.sin(player.heading) * player.speed * dt;

    handleStuck(player, runtime, dt);
    updateWrongWay(player, runtime, dt);
  }
}

function handleStuck(player: RuntimePlayer, runtime: KartRacingRuntime, dt: number): void {
  const config = runtime.settings.config;
  if (player.speed < config.STUCK_SPEED_THRESHOLD) {
    const moved = Math.hypot(player.x - player.lastStuckX, player.y - player.lastStuckY);
    if (moved < 8) {
      player.stuckMs += dt * 1000;
    } else {
      player.stuckMs = 0;
      player.lastStuckX = player.x;
      player.lastStuckY = player.y;
    }
  } else {
    player.stuckMs = 0;
    player.lastStuckX = player.x;
    player.lastStuckY = player.y;
  }
  if (player.stuckMs >= config.STUCK_DETECT_MS) {
    // Gently realign toward the nearest road direction and nudge forward.
    const nearest = nearestRoadPointForRuntime(runtime, player);
    const heading = Math.atan2(nearest.dy, nearest.dx);
    player.heading = heading;
    player.speed = 40;
    player.x += Math.cos(heading) * 8;
    player.y += Math.sin(heading) * 8;
    player.stuckMs = 0;
    player.lastStuckX = player.x;
    player.lastStuckY = player.y;
  }
}

function nearestRoadPointForRuntime(
  runtime: KartRacingRuntime,
  player: RuntimePlayer,
): { dx: number; dy: number } {
  const nearest = nearestRoad(runtime, player);
  return { dx: nearest.dx, dy: nearest.dy };
}

function nearestRoad(
  runtime: KartRacingRuntime,
  player: RuntimePlayer,
): { dx: number; dy: number } {
  const track = runtime.track;
  const points = track.centerline;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index++) {
    const point = points[index] ?? { x: 0, y: 0 };
    const distance = Math.hypot(player.x - point.x, player.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  const tangent = trackTangentForIndex(track, bestIndex);
  return tangent;
}

function trackTangentForIndex(
  track: KartRacingRuntime["track"],
  index: number,
): { dx: number; dy: number } {
  const length = track.centerline.length;
  const previous = track.centerline[(index - 1 + length) % length] ?? { x: 0, y: 0 };
  const next = track.centerline[(index + 1) % length] ?? { x: 0, y: 0 };
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  return { dx: dx / magnitude, dy: dy / magnitude };
}

function updateWrongWay(player: RuntimePlayer, runtime: KartRacingRuntime, dt: number): void {
  const config = runtime.settings.config;
  const tangent = nearestRoad(runtime, player);
  const tangentAngle = Math.atan2(tangent.dy, tangent.dx);
  const error = Math.abs(angleDifference(player.heading, tangentAngle));
  if (error > Math.PI * 0.75 && player.speed > 20) {
    player.wrongWayTimerMs += dt * 1000;
  } else {
    player.wrongWayTimerMs = Math.max(0, player.wrongWayTimerMs - dt * 2_000);
  }
  player.wrongWay = player.wrongWayTimerMs >= config.WRONG_WAY_DETECT_MS;
  if (player.wrongWayTimerMs > 0 && player.wrongWayTimerMs < config.WRONG_WAY_DETECT_MS) {
    player.wrongWay = false;
  }
}

function handleFalling(runtime: KartRacingRuntime, now: number): void {
  for (const player of runtime.players.values()) {
    if (!player.active || !player.connected || player.removed || player.finished) {
      continue;
    }
    if (!isInFallZone(runtime.track, player.x, player.y)) {
      continue;
    }
    const lastGateIndex = lastPassedGateIndex(runtime, player);
    const occupied = (x: number, y: number): boolean =>
      [...runtime.players.values()].some(
        (other) =>
          other.sessionId !== player.sessionId &&
          other.active &&
          Math.hypot(other.x - x, other.y - y) < runtime.settings.config.KART_RADIUS * 2,
      );
    const respawn = safeRespawnPoint(runtime.track, lastGateIndex, occupied);
    player.active = false;
    player.speed = 0;
    player.steering = 0;
    player.hitStopUntil = 0;
    player.immunityUntil = 0;
    player.respawnImmunityUntil = 0;
    player.respawnPoint = respawn;
    player.respawnHeading = respawn.heading;
    player.respawnUntil = now + runtime.settings.config.RESPAWN_DELAY_MS;
  }
}

function lastPassedGateIndex(runtime: KartRacingRuntime, player: RuntimePlayer): number {
  const track = runtime.track;
  if (player.nextCheckpointIndex === 0) {
    return track.finishIndex;
  }
  return track.checkpointIndexes[player.nextCheckpointIndex - 1] ?? track.finishIndex;
}

function handleCheckpoints(runtime: KartRacingRuntime, now: number): void {
  const config = runtime.settings.config;
  const requiredCount = runtime.track.checkpointIndexes.length;
  for (const player of runtime.players.values()) {
    if (!player.active || !player.connected || player.removed || player.finished) {
      continue;
    }
    const gateIndex = gateCenterlineIndex(runtime.track, player.nextCheckpointIndex);
    const line = checkpointForGate(runtime.track, gateIndex);
    const previous: TrackPoint = { x: player.prevX, y: player.prevY };
    const current: TrackPoint = { x: player.x, y: player.y };
    if (crossesCheckpointForward(previous, current, line)) {
      if (player.nextCheckpointIndex < requiredCount) {
        player.nextCheckpointIndex += 1;
      } else {
        player.completedLaps += 1;
        player.nextCheckpointIndex = 0;
        player.collectedCrateIds.clear();
        if (player.completedLaps >= config.LAPS_PER_RACE) {
          finishPlayer(runtime, player, now);
        }
      }
    } else if (crossesCheckpointBackward(previous, current, line)) {
      player.wrongWayTimerMs = Math.max(player.wrongWayTimerMs, config.WRONG_WAY_DETECT_MS * 0.5);
    }
  }
}

function finishPlayer(runtime: KartRacingRuntime, player: RuntimePlayer, now: number): void {
  player.finished = true;
  player.active = false;
  player.speed = Math.min(player.speed, 60);
  player.steering = 0;
  player.finishPosition = runtime.raceFinishOrder.length + 1;
  player.finishTimeMs = Math.max(0, now - runtime.raceStartedAt);
  runtime.raceFinishOrder.push(player.sessionId);
  if (runtime.raceFinishOrder.length === 1) {
    runtime.raceFinishTimeoutEndsAt = Math.min(
      runtime.raceFinishTimeoutEndsAt,
      now + runtime.settings.raceFinishTimeoutMs,
    );
  }
}

function handleCrateCollection(runtime: KartRacingRuntime): void {
  const config = runtime.settings.config;
  for (const player of runtime.players.values()) {
    if (!player.active || !player.connected || player.removed || player.finished) {
      continue;
    }
    if (player.ammoLoaded) {
      continue;
    }
    for (const crate of runtime.activeCrates) {
      if (player.collectedCrateIds.has(crate.id)) {
        continue;
      }
      if (
        Math.hypot(player.x - crate.x, player.y - crate.y) <=
        config.KART_RADIUS + config.CRATE_RADIUS
      ) {
        player.ammoLoaded = true;
        player.collectedCrateIds.add(crate.id);
      }
    }
  }
}

function updateProjectiles(runtime: KartRacingRuntime, stepMs: number, now: number): void {
  const config = runtime.settings.config;
  const dt = stepMs / 1000;
  for (let index = runtime.projectiles.length - 1; index >= 0; index--) {
    const projectile = runtime.projectiles[index];
    if (projectile === undefined) {
      continue;
    }
    projectile.remainingMs -= stepMs;
    if (projectile.remainingMs <= 0) {
      runtime.projectiles.splice(index, 1);
      continue;
    }
    projectile.x += Math.cos(projectile.heading) * runtime.settings.projectileSpeed * dt;
    projectile.y += Math.sin(projectile.heading) * runtime.settings.projectileSpeed * dt;
    if (
      nearestWallHit(runtime.track, projectile.x, projectile.y, config.PROJECTILE_RADIUS) !==
        null ||
      nearestObstacleHit(runtime.track, projectile.x, projectile.y, config.PROJECTILE_RADIUS) !==
        null
    ) {
      runtime.projectiles.splice(index, 1);
      continue;
    }
    const outcome = projectileKartHit(runtime, projectile, now);
    if (outcome.status === "hit" && outcome.player !== null) {
      applyProjectileHit(outcome.player, now, runtime.settings.config);
      runtime.projectiles.splice(index, 1);
    } else if (outcome.status === "blocked") {
      // Immune or already-stopped karts destroy the projectile but are not
      // affected; a later shot cannot stack a second stop.
      runtime.projectiles.splice(index, 1);
    }
  }
}

function projectileKartHit(
  runtime: KartRacingRuntime,
  projectile: RuntimeProjectile,
  now: number,
): { status: "hit" | "blocked" | "none"; player: RuntimePlayer | null } {
  const config = runtime.settings.config;
  for (const player of runtime.players.values()) {
    if (
      !player.active ||
      !player.connected ||
      player.removed ||
      player.finished ||
      player.sessionId === projectile.ownerSessionId
    ) {
      continue;
    }
    if (
      Math.hypot(player.x - projectile.x, player.y - projectile.y) >
      config.KART_RADIUS + config.PROJECTILE_RADIUS
    ) {
      continue;
    }
    // Immune karts destroy the projectile but are unaffected. A kart already
    // in hit-stop cannot be stopped again; the projectile is still consumed.
    if (
      player.immunityUntil > now ||
      player.respawnImmunityUntil > now ||
      player.hitStopUntil > now
    ) {
      return { status: "blocked", player: null };
    }
    return { status: "hit", player };
  }
  return { status: "none", player: null };
}

function applyProjectileHit(
  player: RuntimePlayer,
  now: number,
  config: typeof KART_RACING_SERVER_CONSTANTS,
): void {
  player.speed = 0;
  player.steering = 0;
  player.hitStopUntil = now + config.HIT_STOP_MS;
  player.immunityUntil = player.hitStopUntil + config.HIT_IMMUNITY_MS;
}

function resolveKartCollisions(runtime: KartRacingRuntime, now: number): void {
  const config = runtime.settings.config;
  const karts = [...runtime.players.values()].filter(
    (player) =>
      player.active &&
      player.connected &&
      !player.removed &&
      !player.finished &&
      player.respawnImmunityUntil <= now,
  );
  for (let i = 0; i < karts.length; i++) {
    const a = karts[i];
    for (let j = i + 1; j < karts.length; j++) {
      const b = karts[j];
      if (a === undefined || b === undefined) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const minDistance = config.KART_RADIUS * 2;
      if (distance >= minDistance || distance === 0) {
        continue;
      }
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      a.x -= nx * (overlap / 2);
      a.y -= ny * (overlap / 2);
      b.x += nx * (overlap / 2);
      b.y += ny * (overlap / 2);

      const v1x = Math.cos(a.heading) * a.speed;
      const v1y = Math.sin(a.heading) * a.speed;
      const v2x = Math.cos(b.heading) * b.speed;
      const v2y = Math.sin(b.heading) * b.speed;
      const approach = (v1x - v2x) * nx + (v1y - v2y) * ny;
      if (approach > 0) {
        const push = Math.min(approach * config.PLAYER_PUSH_STRENGTH, 60);
        applyCollisionVelocity(a, v1x - nx * push, v1y - ny * push, runtime.settings.maxSpeed);
        applyCollisionVelocity(b, v2x + nx * push, v2y + ny * push, runtime.settings.maxSpeed);
      }
    }
  }
}

function applyCollisionVelocity(
  player: RuntimePlayer,
  vx: number,
  vy: number,
  maxSpeed: number,
): void {
  const speed = Math.min(maxSpeed, Math.hypot(vx, vy));
  if (speed > 1) {
    const target = Math.atan2(vy, vx);
    player.heading = normalizeAngle(
      player.heading + angleDifference(player.heading, target) * 0.35,
    );
    player.speed = Math.max(player.speed * 0.85, speed * 0.9);
  } else {
    player.speed = Math.max(0, player.speed - 4);
  }
}

export function endRace(runtime: KartRacingRuntime, now: number): void {
  if (runtime.phase !== "racing") {
    return;
  }
  const participants = [...runtime.players.values()].filter((player) => !player.removed);
  const finished = participants
    .filter((player) => player.finishPosition > 0)
    .sort((a, b) => a.finishPosition - b.finishPosition);
  const unfinished = participants
    .filter((player) => player.finishPosition === 0)
    .sort((a, b) => compareRaceOrder(runtime, a, b));
  const ordered = [...finished, ...unfinished];
  const entries = ordered.map((player, index) => {
    const position = index + 1;
    const points = KART_RACING_POINTS[position - 1] ?? 0;
    return {
      sessionId: player.sessionId,
      label: player.name,
      position,
      points,
      finishTimeMs: player.finishTimeMs,
      timedOut: player.finishPosition === 0,
    };
  });
  for (const entry of entries) {
    const player = runtime.players.get(entry.sessionId);
    if (player === undefined) {
      continue;
    }
    player.racePoints = entry.points;
    player.matchPoints += entry.points;
    if (entry.position === 1) {
      player.raceWins += 1;
    } else if (entry.position === 2) {
      player.secondPlaces += 1;
    } else if (entry.position === 3) {
      player.thirdPlaces += 1;
    }
    if (!entry.timedOut) {
      player.totalRaceTimeMs += entry.finishTimeMs;
    }
    player.lastRacePosition = entry.position;
    player.lastRaceTimedOut = entry.timedOut;
    player.timedOut = entry.timedOut;
    player.racePosition = entry.position;
  }
  runtime.raceResult = entries;
  runtime.projectiles = [];
  runtime.phase = "race-result";
  runtime.resultsEndsAt = now + runtime.settings.resultsMs;
}

/** Recomputes every participant's live race position from authoritative progress. */
export function updateRacePositions(runtime: KartRacingRuntime): void {
  const participants = [...runtime.players.values()].filter((player) => !player.removed);
  const ordered = participants.sort((a, b) => {
    const aFinished = a.finishPosition > 0 ? 0 : 1;
    const bFinished = b.finishPosition > 0 ? 0 : 1;
    return (
      aFinished - bFinished ||
      (a.finishPosition > 0 && b.finishPosition > 0
        ? a.finishPosition - b.finishPosition
        : compareRaceOrder(runtime, a, b))
    );
  });
  ordered.forEach((player, index) => {
    player.racePosition = index + 1;
  });
}

function compareRaceOrder(runtime: KartRacingRuntime, a: RuntimePlayer, b: RuntimePlayer): number {
  const pa = playerProgress(runtime, a);
  const pb = playerProgress(runtime, b);
  return (
    pb.completedLaps - pa.completedLaps ||
    pb.nextCheckpointIndex - pa.nextCheckpointIndex ||
    pb.fraction - pa.fraction ||
    a.joinedOrder - b.joinedOrder
  );
}

/** Ends the race immediately when every participant has disconnected. */
export function endRaceIfAllDisconnected(runtime: KartRacingRuntime, now: number): void {
  if (runtime.phase !== "racing") {
    return;
  }
  const hasConnected = [...runtime.players.values()].some(
    (player) => !player.removed && player.connected,
  );
  if (!hasConnected) {
    endRace(runtime, now);
  }
}

/**
 * Creates a projectile from the firing kart and consumes its ammo. The room
 * validates phase, membership, eligibility, sequence, and rate before calling
 * this; the engine owns the authoritative projectile itself.
 */
export function fireProjectile(runtime: KartRacingRuntime, player: RuntimePlayer): void {
  const config = runtime.settings.config;
  runtime.projectiles.push({
    id: `projectile-${runtime.nextProjectileId++}`,
    ownerSessionId: player.sessionId,
    x: player.x + Math.cos(player.heading) * config.PROJECTILE_SPAWN_AHEAD,
    y: player.y + Math.sin(player.heading) * config.PROJECTILE_SPAWN_AHEAD,
    heading: player.heading,
    remainingMs: config.PROJECTILE_LIFETIME_MS,
  });
  player.ammoLoaded = false;
}

function finishMatch(runtime: KartRacingRuntime): void {
  runtime.phase = "finished";
  runtime.resultsEndsAt = 0;
  runtime.raceFinishTimeoutEndsAt = 0;
  runtime.result = buildKartRacingResult(runtime);
}
