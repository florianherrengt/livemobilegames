/**
 * Central typed gameplay configuration. Every value that affects simulation,
 * collision or course generation lives here so scenes and server code never
 * scatter unexplained literals.
 */
export const FLAPPY_RACE_CONFIG = {
  gameId: "flappy_race",
  minPlayers: 2,
  maxPlayers: 8,
  totalRounds: 5,

  // World
  worldWidth: 390,
  worldHeight: 844,

  // Bird
  birdX: 70,
  birdWidth: 34,
  birdHeight: 30,
  birdStartY: 380,
  gravity: 1900,
  flapImpulse: 430,
  maxFallSpeed: 560,

  // Course
  obstacleWidth: 74,
  gapSize: 210,
  obstacleSpacing: 230,
  courseSpeed: 170,
  safeStartDistance: 180,
  upperMargin: 70,
  lowerMargin: 50,
  maxObstacles: 120,

  // Timing
  countdownMs: 3_000,
  roundResultMs: 3_000,
  simulationStepMs: 30,
  maxCatchUpMs: 250,

  // Input protection
  maxFlapsPerSecond: 20,

  // E2E / deterministic test mode overrides (server-side only)
  e2eCountdownMs: 700,
  e2eRoundResultMs: 800,
  e2eCourseSpeed: 450,
  e2eCourseSeed: "flappy-race-e2e-deterministic",
} as const;

export type FlappyRaceConfig = typeof FLAPPY_RACE_CONFIG;

/**
 * Curated colour-blind conscious palette (Okabe-Ito). Assigned by the server
 * at match start and kept stable for the whole match. Yellow is reserved for
 * later joiners and still reads on the dark background.
 */
export const PLAYER_COLORS = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#D55E00",
  "#F0E442",
  "#882255",
] as const;

export const MAX_PLAYERS = FLAPPY_RACE_CONFIG.maxPlayers;

export function playerColorFor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length] ?? PLAYER_COLORS[0] ?? "#ffffff";
}
