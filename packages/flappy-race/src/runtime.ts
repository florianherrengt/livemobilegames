import { FLAPPY_RACE_CONFIG, playerColorFor } from "./constants.js";
import { generateOpenings } from "./course.js";
import type {
  FlappyRacePhase,
  FlappyRaceRuntime,
  FlappyRaceSettings,
  RuntimePlayer,
} from "./types.js";

export function createSettings(e2eMode: boolean): FlappyRaceSettings {
  return {
    config: FLAPPY_RACE_CONFIG,
    e2eMode,
    countdownMs: e2eMode ? FLAPPY_RACE_CONFIG.e2eCountdownMs : FLAPPY_RACE_CONFIG.countdownMs,
    roundResultMs: e2eMode ? FLAPPY_RACE_CONFIG.e2eRoundResultMs : FLAPPY_RACE_CONFIG.roundResultMs,
    courseSpeed: e2eMode ? FLAPPY_RACE_CONFIG.e2eCourseSpeed : FLAPPY_RACE_CONFIG.courseSpeed,
  };
}

export function createRuntime(settings: FlappyRaceSettings): FlappyRaceRuntime {
  return {
    phase: "lobby",
    totalRounds: 0,
    roundNumber: 0,
    countdownEndsAt: 0,
    roundStartedAt: 0,
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
    birdY: FLAPPY_RACE_CONFIG.birdStartY,
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

export function seedForRound(now: number, e2eMode: boolean): string {
  if (e2eMode) {
    return FLAPPY_RACE_CONFIG.e2eCourseSeed;
  }
  return `flappy-${now}-${Math.random()}`;
}

export function resetPlayerForRound(player: RuntimePlayer): void {
  player.roundActive = player.eligible;
  player.eliminated = false;
  player.birdY = FLAPPY_RACE_CONFIG.birdStartY;
  player.birdVy = 0;
  player.clearedObstacleCount = 0;
  player.nextObstacleIndex = 0;
  player.flapQueued = false;
  player.lastFlapSequence = 0;
  player.seenFlapSequences.clear();
  player.roundWonThisRound = false;
}

export function resetRuntime(runtime: FlappyRaceRuntime): void {
  runtime.phase = "lobby";
  runtime.totalRounds = 0;
  runtime.roundNumber = 0;
  runtime.countdownEndsAt = 0;
  runtime.roundStartedAt = 0;
  runtime.courseElapsedMs = 0;
  runtime.resultsEndsAt = 0;
  runtime.courseSeed = "";
  runtime.openings = [];
  runtime.roundWinnerSessionIds = [];
  runtime.roundEnded = false;
  runtime.simAccumMs = 0;
  runtime.lastTickAt = 0;
  runtime.players.clear();
}

export function prepareRound(runtime: FlappyRaceRuntime, now: number): void {
  const config = runtime.settings.config;
  runtime.phase = "countdown";
  runtime.roundEnded = false;
  runtime.roundWinnerSessionIds = [];
  runtime.courseElapsedMs = 0;
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
  runtime.countdownEndsAt = now + runtime.settings.countdownMs;
  runtime.roundStartedAt = 0;
  runtime.resultsEndsAt = 0;
  runtime.courseSeed = seedForRound(now, runtime.settings.e2eMode);
  runtime.openings = generateOpenings(
    config,
    runtime.courseSeed,
    config.maxObstacles,
    runtime.settings.e2eMode,
  );
  for (const player of runtime.players.values()) {
    resetPlayerForRound(player);
  }
}

export function beginRunning(runtime: FlappyRaceRuntime, now: number): void {
  runtime.phase = "running";
  runtime.roundStartedAt = now;
  runtime.courseElapsedMs = 0;
  runtime.lastTickAt = now;
  runtime.simAccumMs = 0;
}

export function candidatesOf(runtime: FlappyRaceRuntime): Array<{
  sessionId: string;
  clearedObstacleCount: number;
  roundActive: boolean;
  eligible: boolean;
}> {
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
