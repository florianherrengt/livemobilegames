import { randomBytes } from "node:crypto";

import { FLAPPY_RACE_SERVER_CONSTANTS, playerColorFor } from "./constants.js";
import { generateOpenings } from "./course.js";
import type {
  FlappyRacePhase,
  FlappyRaceRuntime,
  FlappyRaceSettings,
  RoundProgressCandidate,
  RuntimePlayer,
} from "./types.js";

export function createSettings(e2eMode: boolean): FlappyRaceSettings {
  return {
    config: FLAPPY_RACE_SERVER_CONSTANTS,
    e2eMode,
    countdownMs: e2eMode
      ? FLAPPY_RACE_SERVER_CONSTANTS.E2E_COUNTDOWN_MS
      : FLAPPY_RACE_SERVER_CONSTANTS.COUNTDOWN_MS,
    roundResultMs: e2eMode
      ? FLAPPY_RACE_SERVER_CONSTANTS.E2E_ROUND_RESULT_MS
      : FLAPPY_RACE_SERVER_CONSTANTS.ROUND_RESULT_MS,
    courseSpeed: e2eMode
      ? FLAPPY_RACE_SERVER_CONSTANTS.E2E_COURSE_SPEED
      : FLAPPY_RACE_SERVER_CONSTANTS.COURSE_SPEED,
  };
}

export function createRuntime(settings: FlappyRaceSettings): FlappyRaceRuntime {
  return {
    phase: "lobby",
    totalRounds: 0,
    roundNumber: 0,
    countdownEndsAt: 0,
    courseElapsedMs: 0,
    resultsEndsAt: 0,
    courseSeed: "",
    openings: [],
    roundWinnerSessionIds: [],
    roundEnded: false,
    simAccumMs: 0,
    lastTickAt: 0,
    players: new Map(),
    settings,
    result: null,
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
    eligible: true,
    roundActive: false,
    eliminated: false,
    birdY: FLAPPY_RACE_SERVER_CONSTANTS.BIRD_START_Y,
    birdVy: 0,
    clearedObstacleCount: 0,
    nextObstacleIndex: 0,
    flapQueued: false,
    lastFlapSequence: 0,
    seenFlapSequences: new Set(),
    roundWins: 0,
    roundWonThisRound: false,
    color,
    joinedOrder,
  };
}

export function seedForRound(e2eMode: boolean): string {
  if (e2eMode) {
    return FLAPPY_RACE_SERVER_CONSTANTS.E2E_COURSE_SEED;
  }
  return randomBytes(16).toString("hex");
}

export function resetPlayerForRound(player: RuntimePlayer): void {
  player.roundActive = player.eligible;
  player.eliminated = false;
  player.birdY = FLAPPY_RACE_SERVER_CONSTANTS.BIRD_START_Y;
  player.birdVy = 0;
  player.clearedObstacleCount = 0;
  player.nextObstacleIndex = 0;
  player.flapQueued = false;
  player.lastFlapSequence = 0;
  player.seenFlapSequences.clear();
  player.roundWonThisRound = false;
}

/** Returns everyone to the game-room lobby and clears all match state. */
export function returnToLobby(runtime: FlappyRaceRuntime): void {
  runtime.phase = "lobby";
  runtime.totalRounds = 0;
  runtime.roundNumber = 0;
  runtime.countdownEndsAt = 0;
  runtime.courseElapsedMs = 0;
  runtime.resultsEndsAt = 0;
  runtime.courseSeed = "";
  runtime.openings = [];
  runtime.roundWinnerSessionIds = [];
  runtime.roundEnded = false;
  runtime.simAccumMs = 0;
  runtime.lastTickAt = 0;
  runtime.result = null;

  for (const player of runtime.players.values()) {
    player.eligible = player.connected;
    player.roundActive = false;
    player.eliminated = false;
    player.birdY = FLAPPY_RACE_SERVER_CONSTANTS.BIRD_START_Y;
    player.birdVy = 0;
    player.clearedObstacleCount = 0;
    player.nextObstacleIndex = 0;
    player.flapQueued = false;
    player.lastFlapSequence = 0;
    player.seenFlapSequences.clear();
    player.roundWins = 0;
    player.roundWonThisRound = false;
  }
}

/** Clears the completed match so Play again starts round 1 of a fresh match. */
export function resetForNewMatch(runtime: FlappyRaceRuntime): void {
  returnToLobby(runtime);
}

export function prepareRound(runtime: FlappyRaceRuntime, now: number, roundNumber: number): void {
  const config = runtime.settings.config;
  runtime.phase = "countdown";
  runtime.roundNumber = roundNumber;
  runtime.roundEnded = false;
  runtime.roundWinnerSessionIds = [];
  runtime.courseElapsedMs = 0;
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
  runtime.countdownEndsAt = now + runtime.settings.countdownMs;
  runtime.resultsEndsAt = 0;
  runtime.courseSeed = seedForRound(runtime.settings.e2eMode);
  runtime.openings = generateOpenings(
    config,
    runtime.courseSeed,
    config.MAX_OBSTACLES,
    runtime.settings.e2eMode,
  );
  for (const player of runtime.players.values()) {
    resetPlayerForRound(player);
  }
}

export function startMatch(runtime: FlappyRaceRuntime, now: number): boolean {
  const participants = [...runtime.players.values()].filter((player) => player.connected);
  if (participants.length < runtime.settings.config.MIN_PLAYERS) {
    return false;
  }

  for (const player of runtime.players.values()) {
    player.eligible = player.connected;
    player.roundWins = 0;
    player.roundWonThisRound = false;
  }
  assignColors(runtime);
  runtime.totalRounds = runtime.settings.config.TOTAL_ROUNDS;
  prepareRound(runtime, now, 1);
  return true;
}

export function beginRunning(runtime: FlappyRaceRuntime, now: number): void {
  runtime.phase = "running";
  runtime.courseElapsedMs = 0;
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
}

export function candidatesOf(runtime: FlappyRaceRuntime): RoundProgressCandidate[] {
  return [...runtime.players.values()].map((player) => ({
    sessionId: player.sessionId,
    clearedObstacleCount: player.clearedObstacleCount,
    roundActive: player.roundActive,
    eligible: player.eligible,
  }));
}

export function assignColors(runtime: FlappyRaceRuntime): void {
  const ordered = [...runtime.players.values()].sort((a, b) => a.joinedOrder - b.joinedOrder);
  ordered.forEach((player, index) => {
    player.color = playerColorFor(index);
  });
}

export type { FlappyRacePhase };
