import { randomBytes } from "node:crypto";

import {
  KART_RACING_TRACK,
  type KartRacingTrack,
  progressTowardNextGate as protocolProgressTowardNextGate,
} from "@phone-party/protocol";

import { KART_RACING_SERVER_CONSTANTS, playerColorFor } from "./constants.js";
import { selectActiveCrates } from "./track.js";
import type { KartRacingRuntime, KartRacingSettings, RuntimePlayer } from "./types.js";

export function createSettings(e2eMode: boolean): KartRacingSettings {
  const config = KART_RACING_SERVER_CONSTANTS;
  const scale = e2eMode ? config.E2E_PHYSICS_SCALE : 1;
  return {
    config,
    e2eMode,
    countdownMs: e2eMode ? config.E2E_COUNTDOWN_MS : config.COUNTDOWN_MS,
    resultsMs: e2eMode ? config.E2E_RESULTS_MS : config.RESULTS_MS,
    raceFinishTimeoutMs: e2eMode
      ? config.E2E_RACE_FINISH_TIMEOUT_MS
      : config.RACE_FINISH_TIMEOUT_MS,
    raceMaxDurationMs: e2eMode ? config.E2E_RACE_MAX_DURATION_MS : config.RACE_MAX_DURATION_MS,
    maxSpeed: config.MAX_SPEED * scale,
    acceleration: config.ACCELERATION * scale,
    steeringStrength: config.STEERING_STRENGTH * scale,
    projectileSpeed: config.PROJECTILE_SPEED * scale,
  };
}

export function createRuntime(settings: KartRacingSettings): KartRacingRuntime {
  return {
    phase: "lobby",
    totalRaces: 0,
    raceNumber: 0,
    track: KART_RACING_TRACK,
    countdownEndsAt: 0,
    raceStartedAt: 0,
    raceFinishTimeoutEndsAt: 0,
    resultsEndsAt: 0,
    raceSeed: "",
    activeCrates: [],
    raceFinishOrder: [],
    raceResult: null,
    result: null,
    simAccumMs: 0,
    lastTickAt: 0,
    players: new Map(),
    projectiles: [],
    settings,
    nextProjectileId: 0,
    startingGrid: [],
  };
}

export function createRuntimePlayer(
  sessionId: string,
  playerId: string,
  name: string,
  joinedOrder: number,
  color: string,
): RuntimePlayer {
  return {
    sessionId,
    playerId,
    name,
    connected: true,
    joinedOrder,
    color,
    removed: false,
    matchPoints: 0,
    raceWins: 0,
    secondPlaces: 0,
    thirdPlaces: 0,
    totalRaceTimeMs: 0,
    raceActive: true,
    active: false,
    finished: false,
    timedOut: false,
    completedLaps: 0,
    nextCheckpointIndex: 0,
    finishPosition: 0,
    finishTimeMs: 0,
    racePoints: 0,
    lastRacePosition: 0,
    lastRaceTimedOut: false,
    racePosition: 0,
    x: 0,
    y: 0,
    heading: KART_RACING_TRACK.startingHeading,
    speed: 0,
    steering: 0,
    targetSteering: 0,
    ammoLoaded: false,
    collectedCrateIds: new Set(),
    hitStopUntil: 0,
    immunityUntil: 0,
    respawnImmunityUntil: 0,
    respawnUntil: 0,
    respawnPoint: null,
    respawnHeading: KART_RACING_TRACK.startingHeading,
    wrongWay: false,
    wrongWayTimerMs: 0,
    stuckMs: 0,
    lastStuckX: 0,
    lastStuckY: 0,
    lastSteerSequence: 0,
    seenSteerSequences: new Set(),
    lastShootSequence: 0,
    seenShootSequences: new Set(),
    prevX: 0,
    prevY: 0,
  };
}

export function seedForRace(e2eMode: boolean, raceNumber: number): string {
  if (e2eMode) {
    return `${KART_RACING_SERVER_CONSTANTS.E2E_RACE_SEED}-${raceNumber}`;
  }
  return randomBytes(16).toString("hex");
}

export function assignColors(runtime: KartRacingRuntime): void {
  const ordered = [...runtime.players.values()].sort((a, b) => a.joinedOrder - b.joinedOrder);
  ordered.forEach((player, index) => {
    player.color = playerColorFor(index);
  });
}

function resetPlayerForRace(
  player: RuntimePlayer,
  gridPosition: { x: number; y: number },
  heading: number,
): void {
  player.raceActive = !player.removed;
  player.active = player.connected && !player.removed;
  player.finished = false;
  player.timedOut = false;
  player.completedLaps = 0;
  player.nextCheckpointIndex = 0;
  player.finishPosition = 0;
  player.finishTimeMs = 0;
  player.racePoints = 0;
  player.racePosition = 0;
  player.x = gridPosition.x;
  player.y = gridPosition.y;
  player.prevX = gridPosition.x;
  player.prevY = gridPosition.y;
  player.heading = heading;
  player.speed = 0;
  player.steering = 0;
  player.targetSteering = 0;
  player.ammoLoaded = false;
  player.collectedCrateIds.clear();
  player.hitStopUntil = 0;
  player.immunityUntil = 0;
  player.respawnImmunityUntil = 0;
  player.respawnUntil = 0;
  player.respawnPoint = null;
  player.wrongWay = false;
  player.wrongWayTimerMs = 0;
  player.stuckMs = 0;
  player.lastStuckX = gridPosition.x;
  player.lastStuckY = gridPosition.y;
}

function gridOrderForRace(runtime: KartRacingRuntime, raceNumber: number): string[] {
  const participants = [...runtime.players.values()]
    .filter((player) => !player.removed)
    .sort((a, b) => a.joinedOrder - b.joinedOrder);
  if (raceNumber === 1) {
    return shuffleDeterministic(participants, runtime.raceSeed).map((player) => player.sessionId);
  }
  const previous = [...runtime.players.values()].filter((player) => !player.removed);
  const finished = previous
    .filter((player) => player.finishPosition > 0)
    .sort((a, b) => a.finishPosition - b.finishPosition);
  const unfinished = previous
    .filter((player) => player.finishPosition === 0)
    .sort(
      (a, b) =>
        b.completedLaps - a.completedLaps ||
        b.nextCheckpointIndex - a.nextCheckpointIndex ||
        a.joinedOrder - b.joinedOrder,
    );
  // Reverse finishing order: the last-place finisher starts first. Players who
  // timed out or disconnected were ranked behind the last normal finisher in
  // the previous race, so after reversal they start immediately behind that
  // finisher and ahead of the remaining finishers. The winner starts last.
  const lastFinisher = finished[finished.length - 1];
  const remainingFinishersReversed = finished.slice(0, -1).reverse();
  return [lastFinisher, ...unfinished, ...remainingFinishersReversed]
    .filter((player): player is RuntimePlayer => player !== undefined)
    .map((player) => player.sessionId);
}

function shuffleDeterministic<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  let state = hashSeed(seed);
  for (let index = result.length - 1; index > 0; index--) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const random = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const swapIndex = Math.floor(random * (index + 1));
    const a = result[index];
    const b = result[swapIndex];
    if (a !== undefined && b !== undefined) {
      result[index] = b;
      result[swapIndex] = a;
    }
  }
  return result;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Clears match state so Play again starts round 1 of a fresh match. */
export function returnToLobby(runtime: KartRacingRuntime): void {
  runtime.phase = "lobby";
  runtime.totalRaces = 0;
  runtime.raceNumber = 0;
  runtime.countdownEndsAt = 0;
  runtime.raceStartedAt = 0;
  runtime.raceFinishTimeoutEndsAt = 0;
  runtime.resultsEndsAt = 0;
  runtime.raceSeed = "";
  runtime.activeCrates = [];
  runtime.raceFinishOrder = [];
  runtime.raceResult = null;
  runtime.result = null;
  runtime.simAccumMs = 0;
  runtime.lastTickAt = 0;
  runtime.projectiles = [];
  runtime.startingGrid = [];

  for (const player of runtime.players.values()) {
    if (player.removed) {
      continue;
    }
    player.matchPoints = 0;
    player.raceWins = 0;
    player.secondPlaces = 0;
    player.thirdPlaces = 0;
    player.totalRaceTimeMs = 0;
    resetPlayerForRace(player, { x: 0, y: 0 }, KART_RACING_TRACK.startingHeading);
    player.raceActive = false;
    player.active = false;
  }
}

export function resetForNewMatch(runtime: KartRacingRuntime): void {
  // Permanently removed players cannot come back after they left the room.
  for (const [sessionId, player] of runtime.players) {
    if (player.removed) {
      runtime.players.delete(sessionId);
    }
  }
  returnToLobby(runtime);
}

export function startMatch(runtime: KartRacingRuntime, now: number): boolean {
  const connected = [...runtime.players.values()].filter(
    (player) => player.connected && !player.removed,
  );
  if (connected.length < runtime.settings.config.MIN_PLAYERS) {
    return false;
  }
  assignColors(runtime);
  runtime.totalRaces = runtime.settings.config.RACES_PER_MATCH;
  prepareRace(runtime, now, 1);
  return true;
}

export function prepareRace(runtime: KartRacingRuntime, now: number, raceNumber: number): void {
  const config = runtime.settings.config;
  const track: KartRacingTrack = runtime.track;
  runtime.phase = "countdown";
  runtime.raceNumber = raceNumber;
  runtime.countdownEndsAt = now + runtime.settings.countdownMs;
  runtime.raceStartedAt = 0;
  runtime.raceFinishTimeoutEndsAt = 0;
  runtime.resultsEndsAt = 0;
  runtime.raceSeed = seedForRace(runtime.settings.e2eMode, raceNumber);
  runtime.activeCrates = selectActiveCrates(
    track,
    runtime.raceSeed,
    runtime.settings.e2eMode ? config.E2E_ACTIVE_CRATE_COUNT : config.ACTIVE_CRATE_COUNT,
  );
  runtime.raceFinishOrder = [];
  runtime.raceResult = null;
  runtime.projectiles = [];
  runtime.nextProjectileId = 0;
  runtime.simAccumMs = 0;
  runtime.lastTickAt = now;
  runtime.startingGrid = gridOrderForRace(runtime, raceNumber);
  const grid = runtime.startingGrid;
  for (const [index, sessionId] of grid.entries()) {
    const player = runtime.players.get(sessionId);
    const gridPosition = track.gridPositions[index] ?? track.gridPositions[0] ?? { x: 0, y: 0 };
    if (player !== undefined && gridPosition !== undefined) {
      resetPlayerForRace(player, gridPosition, track.startingHeading);
    }
  }
  for (const [index, sessionId] of grid.entries()) {
    const player = runtime.players.get(sessionId);
    if (player !== undefined) {
      player.racePosition = index + 1;
    }
  }
  for (const player of runtime.players.values()) {
    if (player.removed) {
      player.raceActive = false;
      player.active = false;
    }
  }
}

export function beginRunning(runtime: KartRacingRuntime, now: number): void {
  runtime.phase = "racing";
  runtime.raceStartedAt = now;
  runtime.raceFinishTimeoutEndsAt = now + runtime.settings.raceMaxDurationMs;
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
}

export function playerProgress(
  runtime: KartRacingRuntime,
  player: RuntimePlayer,
): { completedLaps: number; nextCheckpointIndex: number; fraction: number } {
  const track = runtime.track;
  return {
    completedLaps: player.completedLaps,
    nextCheckpointIndex: player.nextCheckpointIndex,
    fraction: protocolProgressTowardNextGate(
      track,
      { x: player.x, y: player.y },
      player.nextCheckpointIndex,
    ),
  };
}
