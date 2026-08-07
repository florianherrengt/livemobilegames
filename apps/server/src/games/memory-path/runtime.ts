import { randomBytes } from "node:crypto";

import { MEMORY_PATH_CONSTANTS } from "@phone-party/protocol";

import { MEMORY_PATH_SERVER_CONSTANTS, playerColorFor } from "./constants.js";
import {
  LANDMARKS,
  type MemoryPathLandmark,
  type PathTemplate,
  pathWidthForDifficulty,
  routeForDifficulty,
} from "./paths.js";
import type {
  MemoryPathDifficulty,
  MemoryPathRuntime,
  MemoryPathSettings,
  RuntimePlayer,
} from "./types.js";

const EMPTY_ROUTE: PathTemplate = Object.freeze({
  id: "",
  difficulty: "easy",
  points: Object.freeze([
    Object.freeze({ x: MEMORY_PATH_CONSTANTS.START_X, y: MEMORY_PATH_CONSTANTS.START_Y }),
    Object.freeze({ x: MEMORY_PATH_CONSTANTS.FINISH_X, y: MEMORY_PATH_CONSTANTS.FINISH_Y }),
  ]),
});

const EMPTY_LANDMARKS: readonly MemoryPathLandmark[] = Object.freeze([]);

export function createSettings(e2eMode: boolean): MemoryPathSettings {
  if (e2eMode) {
    return {
      e2eMode: true,
      preparingMs: MEMORY_PATH_SERVER_CONSTANTS.E2E_PREPARING_MS,
      previewMs: MEMORY_PATH_SERVER_CONSTANTS.E2E_PREVIEW_MS,
      raceMs: MEMORY_PATH_SERVER_CONSTANTS.E2E_RACE_MS,
      flashIntervalMs: MEMORY_PATH_SERVER_CONSTANTS.E2E_FLASH_INTERVAL_MS,
      flashDurationMs: MEMORY_PATH_SERVER_CONSTANTS.E2E_FLASH_DURATION_MS,
      roundResultMs: MEMORY_PATH_SERVER_CONSTANTS.E2E_ROUND_RESULT_MS,
      movementSpeed: MEMORY_PATH_SERVER_CONSTANTS.E2E_MOVEMENT_SPEED,
    };
  }
  return {
    e2eMode: false,
    preparingMs: MEMORY_PATH_CONSTANTS.PREPARING_MS,
    previewMs: MEMORY_PATH_CONSTANTS.PREVIEW_MS,
    raceMs: MEMORY_PATH_CONSTANTS.RACE_MS,
    flashIntervalMs: MEMORY_PATH_CONSTANTS.FLASH_INTERVAL_MS,
    flashDurationMs: MEMORY_PATH_CONSTANTS.FLASH_DURATION_MS,
    roundResultMs: MEMORY_PATH_CONSTANTS.ROUND_RESULT_MS,
    movementSpeed: MEMORY_PATH_CONSTANTS.MOVEMENT_SPEED,
  };
}

export function seedForMatch(e2eMode: boolean): string {
  return e2eMode ? MEMORY_PATH_SERVER_CONSTANTS.E2E_SEED : randomBytes(16).toString("hex");
}

/** Small deterministic PRNG for route selection; production seeds use crypto. */
export function createSeededRng(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function createRuntime(settings: MemoryPathSettings): MemoryPathRuntime {
  return {
    phase: "lobby",
    totalRounds: 0,
    roundNumber: 0,
    suddenDeath: false,
    preparingEndsAt: 0,
    previewEndsAt: 0,
    raceEndsAt: 0,
    resultsEndsAt: 0,
    raceStartedAt: 0,
    raceElapsedMs: 0,
    pathVisible: false,
    opponentsVisible: false,
    pathWidth: 0,
    route: EMPTY_ROUTE,
    landmarks: EMPTY_LANDMARKS,
    usedRouteIds: new Set(),
    seed: "",
    rng: createSeededRng("unseeded"),
    players: new Map(),
    settings,
    roundResult: null,
    roundResults: [],
    result: null,
    lastTickAt: 0,
  };
}

export function createRuntimePlayer(
  sessionId: string,
  name: string,
  joinedOrder: number,
  color: string,
): RuntimePlayer {
  return {
    sessionId,
    name,
    connected: true,
    participating: false,
    roundActive: false,
    finished: false,
    falling: false,
    respawnEndsAt: 0,
    position: {
      x: MEMORY_PATH_CONSTANTS.START_X,
      y: MEMORY_PATH_CONSTANTS.START_Y,
    },
    inputX: 0,
    inputY: 0,
    progress: 0,
    maxProgress: 0,
    maxProgressFirstReachedAt: 0,
    falls: 0,
    roundWins: 0,
    color,
    joinedOrder,
    lastAcceptedSequence: 0,
    seenMoveSequences: new Set(),
  };
}

export function assignColors(runtime: MemoryPathRuntime): void {
  const ordered = [...runtime.players.values()].sort((a, b) => a.joinedOrder - b.joinedOrder);
  ordered.forEach((player, index) => {
    player.color = playerColorFor(index);
  });
}

export function startMatch(runtime: MemoryPathRuntime, now: number): boolean {
  const participants = [...runtime.players.values()].filter((player) => player.connected);
  if (participants.length < MEMORY_PATH_SERVER_CONSTANTS.MIN_PLAYERS) {
    return false;
  }

  runtime.totalRounds = MEMORY_PATH_CONSTANTS.NORMAL_ROUNDS;
  runtime.suddenDeath = false;
  runtime.usedRouteIds.clear();
  runtime.roundResult = null;
  runtime.roundResults = [];
  runtime.result = null;
  runtime.seed = seedForMatch(runtime.settings.e2eMode);
  runtime.rng = createSeededRng(runtime.seed);

  for (const player of runtime.players.values()) {
    player.roundWins = 0;
  }
  assignColors(runtime);
  try {
    prepareRound(runtime, now, 1, "easy", runtime.players.size > 0);
  } catch (error) {
    if (!(error instanceof Error) || !/No unused .* route available/.test(error.message)) {
      throw error;
    }
    // A route pool can only be exhausted by a corrupted data set; fail the
    // start safely instead of crashing the room.
    returnToLobby(runtime);
    return false;
  }
  return true;
}

/** Prepares a round with the given difficulty and resets every participant. */
export function prepareRound(
  runtime: MemoryPathRuntime,
  now: number,
  roundNumber: number,
  difficulty: MemoryPathDifficulty,
  includeAllPlayers: boolean,
  participants?: ReadonlySet<string>,
): void {
  const route = routeForDifficulty(difficulty, runtime.usedRouteIds, runtime.rng);
  runtime.usedRouteIds.add(route.id);
  runtime.phase = "preparing";
  runtime.roundNumber = roundNumber;
  runtime.pathWidth = pathWidthForDifficulty(difficulty);
  runtime.route = route;
  runtime.landmarks = LANDMARKS;
  runtime.preparingEndsAt = now + runtime.settings.preparingMs;
  runtime.previewEndsAt = 0;
  runtime.raceEndsAt = 0;
  runtime.resultsEndsAt = 0;
  runtime.raceStartedAt = 0;
  runtime.raceElapsedMs = 0;
  runtime.pathVisible = false;
  runtime.opponentsVisible = false;
  runtime.roundResult = null;
  runtime.lastTickAt = now;

  for (const player of runtime.players.values()) {
    const isParticipant = includeAllPlayers || (participants?.has(player.sessionId) ?? false);
    // Participation is decided by round inclusion, not current connectivity:
    // a player who is briefly disconnected when the round is prepared may
    // still rejoin within the reconnection grace and resume at the start.
    player.participating = isParticipant;
    player.roundActive = isParticipant && player.connected;
    player.finished = false;
    player.falling = false;
    player.respawnEndsAt = 0;
    player.position = { x: MEMORY_PATH_CONSTANTS.START_X, y: MEMORY_PATH_CONSTANTS.START_Y };
    player.inputX = 0;
    player.inputY = 0;
    player.progress = 0;
    player.maxProgress = 0;
    player.maxProgressFirstReachedAt = 0;
    player.falls = 0;
  }
}

/** Returns everyone to the game-room lobby and clears all match state. */
export function returnToLobby(runtime: MemoryPathRuntime): void {
  runtime.phase = "lobby";
  runtime.totalRounds = 0;
  runtime.roundNumber = 0;
  runtime.suddenDeath = false;
  runtime.preparingEndsAt = 0;
  runtime.previewEndsAt = 0;
  runtime.raceEndsAt = 0;
  runtime.resultsEndsAt = 0;
  runtime.raceStartedAt = 0;
  runtime.raceElapsedMs = 0;
  runtime.pathVisible = false;
  runtime.opponentsVisible = false;
  runtime.pathWidth = 0;
  runtime.route = EMPTY_ROUTE;
  runtime.landmarks = EMPTY_LANDMARKS;
  runtime.usedRouteIds.clear();
  runtime.roundResult = null;
  runtime.roundResults = [];
  runtime.result = null;
  runtime.seed = "";

  for (const player of runtime.players.values()) {
    player.participating = false;
    player.roundActive = false;
    player.finished = false;
    player.falling = false;
    player.respawnEndsAt = 0;
    player.position = { x: MEMORY_PATH_CONSTANTS.START_X, y: MEMORY_PATH_CONSTANTS.START_Y };
    player.inputX = 0;
    player.inputY = 0;
    player.progress = 0;
    player.maxProgress = 0;
    player.maxProgressFirstReachedAt = 0;
    player.falls = 0;
    player.roundWins = 0;
  }
}

/** Clears the completed match so Play again starts round 1 of a fresh match. */
export function resetForNewMatch(runtime: MemoryPathRuntime): void {
  returnToLobby(runtime);
}
