import { randomBytes } from "node:crypto";

import { COIN_RUSH_CONSTANTS, coinRushClamp, coinRushLerp } from "@phone-party/protocol";

import { spawnInitialCoins } from "./coins.js";
import { COIN_RUSH_SERVER_CONSTANTS, playerColorFor } from "./constants.js";
import { generateRows } from "./map.js";
import { resolveMovement } from "./movement.js";
import { createRng } from "./rng.js";
import { awardCoins, buildResult, resolveThreshold, roundCandidates } from "./scoring.js";
import type { CoinRushRuntime, CoinRushSettings, RuntimePlayer } from "./types.js";
import { vehicleOverlapsInterval } from "./vehicles.js";

export function createRuntime(settings: CoinRushSettings): CoinRushRuntime {
  return {
    phase: "lobby",
    totalRounds: 0,
    roundNumber: 0,
    countdownEndsAt: 0,
    roundResultEndsAt: 0,
    elapsedMs: 0,
    lastTickAt: 0,
    suddenDeath: false,
    seed: "",
    rng: () => 0,
    rows: [],
    players: new Map(),
    coins: new Map(),
    pendingMoves: new Map(),
    roundWinnerSessionIds: [],
    result: null,
    settings,
  };
}

export function addPlayer(
  runtime: CoinRushRuntime,
  sessionId: string,
  name: string,
  joinedOrder: number,
): RuntimePlayer {
  const player: RuntimePlayer = {
    sessionId,
    name,
    connected: true,
    joinedOrder,
    color: playerColorFor(joinedOrder),
    alive: false,
    respawning: false,
    respawnEndsAt: 0,
    moving: false,
    push: false,
    bouncing: false,
    x: 0,
    y: 0,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    moveStartedAt: 0,
    moveEndsAt: 0,
    bounceStartedAt: 0,
    bounceEndsAt: 0,
    deathType: "",
    diedAt: 0,
    score: 0,
    roundWins: 0,
    totalCoins: 0,
    deaths: 0,
    roundDeaths: 0,
    suddenDeathEligible: true,
    lastAcceptedSequence: 0,
    seenSequences: new Set(),
  };
  runtime.players.set(sessionId, player);
  return player;
}

export function removePlayer(runtime: CoinRushRuntime, sessionId: string): void {
  runtime.players.delete(sessionId);
  runtime.pendingMoves.delete(sessionId);
}

/**
 * Starts the first round automatically once the full roster is connected.
 * Returns false when the minimum player count is not met.
 */
export function startMatch(runtime: CoinRushRuntime, now: number): boolean {
  const participants = [...runtime.players.values()].filter((player) => player.connected);
  if (participants.length < COIN_RUSH_CONSTANTS.MIN_PLAYERS) {
    return false;
  }
  runtime.totalRounds = COIN_RUSH_CONSTANTS.TOTAL_ROUNDS;
  prepareRound(runtime, now, 1);
  return true;
}

export function prepareRound(runtime: CoinRushRuntime, now: number, roundNumber: number): void {
  runtime.seed = runtime.settings.e2eMode
    ? COIN_RUSH_SERVER_CONSTANTS.E2E_MATCH_SEED
    : randomBytes(16).toString("hex");
  runtime.rng = createRng(runtime.seed);
  runtime.rows = generateRows(runtime.seed, runtime.settings.e2eMode);
  runtime.phase = "countdown";
  runtime.roundNumber = roundNumber;
  runtime.countdownEndsAt = now + runtime.settings.countdownMs;
  runtime.roundResultEndsAt = 0;
  runtime.elapsedMs = 0;
  runtime.lastTickAt = now;
  runtime.suddenDeath = false;
  runtime.roundWinnerSessionIds = [];
  runtime.pendingMoves.clear();

  const ordered = [...runtime.players.values()]
    .filter((player) => player.connected)
    .sort((a, b) => a.joinedOrder - b.joinedOrder);
  const offset = (roundNumber - 1) % Math.max(1, ordered.length);
  const rotated = [...ordered.slice(offset), ...ordered.slice(0, offset)];
  rotated.forEach((player, index) => {
    player.alive = true;
    player.respawning = false;
    player.respawnEndsAt = 0;
    player.moving = false;
    player.push = false;
    player.bouncing = false;
    player.x = Math.floor((index * COIN_RUSH_CONSTANTS.COL_COUNT) / Math.max(1, rotated.length));
    player.y = index % 2;
    player.fromX = player.x;
    player.fromY = player.y;
    player.toX = player.x;
    player.toY = player.y;
    player.moveStartedAt = 0;
    player.moveEndsAt = 0;
    player.bounceStartedAt = 0;
    player.bounceEndsAt = 0;
    player.deathType = "";
    player.diedAt = 0;
    player.score = 0;
    player.roundDeaths = 0;
    player.suddenDeathEligible = true;
  });
  for (const player of runtime.players.values()) {
    if (!player.connected) {
      player.alive = false;
      player.suddenDeathEligible = false;
    }
  }

  runtime.coins.clear();
  spawnInitialCoins(runtime, now);
}

export function startPlaying(runtime: CoinRushRuntime, now: number): void {
  runtime.phase = "playing";
  runtime.elapsedMs = 0;
  runtime.lastTickAt = now;
  runtime.pendingMoves.clear();
}

/**
 * The authoritative per-tick pipeline. Movement resolution is grouped per
 * tick (the movement-resolution window), collisions are checked continuously,
 * coins are awarded after all successful movements, and the round ends
 * immediately when the threshold is crossed.
 */
export function updateRuntime(runtime: CoinRushRuntime, now: number): void {
  if (runtime.phase === "lobby") {
    return;
  }
  if (runtime.phase === "countdown") {
    runtime.lastTickAt = now;
    if (now >= runtime.countdownEndsAt) {
      startPlaying(runtime, now);
    }
    return;
  }
  if (runtime.phase === "round-result") {
    if (now >= runtime.roundResultEndsAt) {
      if (runtime.roundNumber < runtime.totalRounds) {
        prepareRound(runtime, now, runtime.roundNumber + 1);
      } else {
        finishMatch(runtime);
      }
    }
    return;
  }
  if (runtime.phase !== "playing") {
    return;
  }

  const delta = coinRushClamp(now - runtime.lastTickAt, 0, 250);
  runtime.elapsedMs += delta;
  runtime.lastTickAt = now;

  completeBounces(runtime, now);
  checkVehicleCollisions(runtime, now);
  completeMovements(runtime, now);
  if (runtime.phase === "playing") {
    resolveMovement(runtime, now);
    checkVehicleCollisions(runtime, now);
  }
  const collected = awardCoins(runtime, now);
  evaluateRoundWin(runtime, now, collected);
  updateRespawns(runtime, now);
}

function completeMovements(runtime: CoinRushRuntime, now: number): void {
  for (const player of runtime.players.values()) {
    if (!player.moving || now < player.moveEndsAt) {
      continue;
    }
    if (player.alive) {
      player.x = player.toX;
      player.y = player.toY;
    }
    player.moving = false;
    player.push = false;
  }
}

function completeBounces(runtime: CoinRushRuntime, now: number): void {
  for (const player of runtime.players.values()) {
    if (player.bouncing && now >= player.bounceEndsAt) {
      player.bouncing = false;
    }
  }
}

function checkVehicleCollisions(runtime: CoinRushRuntime, now: number): void {
  const halfWidth = (1 - 2 * COIN_RUSH_CONSTANTS.PLAYER_COLLISION_MARGIN) / 2;
  for (const player of runtime.players.values()) {
    if (!player.alive || player.respawning) {
      continue;
    }
    let centerX: number;
    let centerY: number;
    if (player.moving) {
      if (
        now - player.moveStartedAt <= COIN_RUSH_SERVER_CONSTANTS.SERVER_UPDATE_MS &&
        player.toY >= 0 &&
        player.toY < COIN_RUSH_CONSTANTS.ROW_COUNT
      ) {
        const destinationRow = runtime.rows.find((candidate) => candidate.row === player.toY);
        if (
          destinationRow &&
          vehicleOverlapsInterval(destinationRow, runtime.elapsedMs, player.toX + 0.5, halfWidth)
        ) {
          killPlayer(runtime, player, "vehicle", now);
          continue;
        }
      }
      const duration = player.push
        ? runtime.settings.pushDurationMs
        : runtime.settings.moveDurationMs;
      const progress = coinRushClamp((now - player.moveStartedAt) / Math.max(1, duration), 0, 1);
      centerX = coinRushLerp(player.fromX, player.toX, progress) + 0.5;
      centerY = coinRushLerp(player.fromY, player.toY, progress) + 0.5;
    } else {
      centerX = player.x + 0.5;
      centerY = player.y + 0.5;
    }
    const minRow = Math.max(0, Math.floor(centerY));
    const maxRow = Math.min(COIN_RUSH_CONSTANTS.ROW_COUNT - 1, Math.ceil(centerY));
    for (let row = minRow; row <= maxRow; row++) {
      const runtimeRow = runtime.rows.find((candidate) => candidate.row === row);
      if (
        runtimeRow &&
        vehicleOverlapsInterval(runtimeRow, runtime.elapsedMs, centerX, halfWidth)
      ) {
        killPlayer(runtime, player, "vehicle", now);
        break;
      }
    }
  }
}

export function killPlayer(
  runtime: CoinRushRuntime,
  player: RuntimePlayer,
  type: "vehicle" | "fall",
  now: number,
): void {
  if (!player.alive) {
    return;
  }
  player.alive = false;
  player.deathType = type;
  player.diedAt = now;
  player.deaths += 1;
  player.roundDeaths += 1;
  player.respawning = true;
  player.respawnEndsAt =
    now + runtime.settings.deathAnimationMs + runtime.settings.respawnCooldownMs;
  runtime.pendingMoves.delete(player.sessionId);
}

function updateRespawns(runtime: CoinRushRuntime, now: number): void {
  for (const player of runtime.players.values()) {
    if (!player.respawning || now < player.respawnEndsAt) {
      continue;
    }
    const cell = selectRespawnCell(runtime, player);
    player.x = cell.x;
    player.y = cell.y;
    player.fromX = cell.x;
    player.fromY = cell.y;
    player.toX = cell.x;
    player.toY = cell.y;
    player.moving = false;
    player.push = false;
    player.bouncing = false;
    player.alive = true;
    player.respawning = false;
    player.respawnEndsAt = 0;
    player.deathType = "";
    player.diedAt = 0;
  }
}

function selectRespawnCell(
  runtime: CoinRushRuntime,
  respawning: RuntimePlayer,
): { x: number; y: number } {
  const occupied = new Set<string>();
  for (const player of runtime.players.values()) {
    if (player.sessionId === respawning.sessionId) {
      continue;
    }
    if (player.alive || player.respawning) {
      occupied.add(`${player.x}:${player.y}`);
    }
    if (player.moving) {
      occupied.add(`${player.toX}:${player.toY}`);
    }
  }
  const candidatesByRow = new Map<number, Array<{ x: number; y: number; score: number }>>();
  for (const row of [0, 1]) {
    const rowCandidates: Array<{ x: number; y: number; score: number }> = [];
    for (let col = 0; col < COIN_RUSH_CONSTANTS.COL_COUNT; col++) {
      if (occupied.has(`${col}:${row}`)) {
        continue;
      }
      let nearest = Number.POSITIVE_INFINITY;
      for (const player of runtime.players.values()) {
        if (player.sessionId === respawning.sessionId || !player.alive) {
          continue;
        }
        const distance = Math.abs(player.x - col) + Math.abs(player.y - row);
        nearest = Math.min(nearest, distance);
      }
      rowCandidates.push({ x: col, y: row, score: nearest });
    }
    candidatesByRow.set(row, rowCandidates);
  }
  // Prefer the primary starting row (0); only fall back to the second safe
  // row when row 0 has no free cell.
  const preferredRow = (candidatesByRow.get(0)?.length ?? 0) > 0 ? 0 : 1;
  const candidates = candidatesByRow.get(preferredRow) ?? [];
  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  return best[Math.floor(runtime.rng() * best.length)] ?? { x: 0, y: 0 };
}

function evaluateRoundWin(
  runtime: CoinRushRuntime,
  now: number,
  collectedThisResolution: ReadonlySet<string>,
): void {
  const candidates = roundCandidates(runtime, collectedThisResolution);
  if (candidates.length === 0) {
    return;
  }
  const resolution = resolveThreshold(runtime, candidates);
  if (resolution.suddenDeath) {
    if (!runtime.suddenDeath) {
      runtime.suddenDeath = true;
    }
    const tiedIds = new Set(resolution.winners.map((player) => player.sessionId));
    for (const player of runtime.players.values()) {
      player.suddenDeathEligible = tiedIds.has(player.sessionId);
    }
    return;
  }
  endRound(
    runtime,
    resolution.winners.map((player) => player.sessionId),
    now,
  );
}

function endRound(runtime: CoinRushRuntime, winnerSessionIds: string[], now: number): void {
  runtime.phase = "round-result";
  runtime.roundWinnerSessionIds = winnerSessionIds;
  runtime.roundResultEndsAt = now + runtime.settings.roundResultMs;
  runtime.suddenDeath = false;
  runtime.pendingMoves.clear();
  for (const winnerSessionId of winnerSessionIds) {
    const winner = runtime.players.get(winnerSessionId);
    if (winner) {
      winner.roundWins += 1;
    }
  }
  for (const player of runtime.players.values()) {
    if (player.moving) {
      player.x = player.toX;
      player.y = player.toY;
    }
    player.moving = false;
    player.push = false;
    player.bouncing = false;
  }
}

function finishMatch(runtime: CoinRushRuntime): void {
  runtime.phase = "finished";
  runtime.roundResultEndsAt = 0;
  runtime.result = buildResult(runtime);
}

/** Clears all round state and returns everyone to the game-room lobby. */
export function returnToLobby(runtime: CoinRushRuntime): void {
  runtime.phase = "lobby";
  runtime.totalRounds = 0;
  runtime.roundNumber = 0;
  runtime.countdownEndsAt = 0;
  runtime.roundResultEndsAt = 0;
  runtime.elapsedMs = 0;
  runtime.lastTickAt = 0;
  runtime.suddenDeath = false;
  runtime.rows = [];
  runtime.coins.clear();
  runtime.pendingMoves.clear();
  runtime.roundWinnerSessionIds = [];
  runtime.result = null;
  for (const player of runtime.players.values()) {
    player.alive = false;
    player.respawning = false;
    player.respawnEndsAt = 0;
    player.moving = false;
    player.push = false;
    player.bouncing = false;
    player.deathType = "";
    player.diedAt = 0;
    player.score = 0;
    player.roundWins = 0;
    player.totalCoins = 0;
    player.deaths = 0;
    player.roundDeaths = 0;
    player.suddenDeathEligible = true;
  }
}

/** Clears the completed match so Play again starts round 1 of a fresh match. */
export function resetForNewMatch(runtime: CoinRushRuntime): void {
  returnToLobby(runtime);
}
