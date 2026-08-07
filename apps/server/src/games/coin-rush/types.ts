import type {
  CoinRushDeathType,
  CoinRushDirection,
  CoinRushPhase,
  CoinRushTerrain,
} from "@phone-party/protocol";

export interface RuntimePlayer {
  sessionId: string;
  name: string;
  connected: boolean;
  joinedOrder: number;
  color: string;
  alive: boolean;
  respawning: boolean;
  respawnEndsAt: number;
  moving: boolean;
  push: boolean;
  bouncing: boolean;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  moveStartedAt: number;
  moveEndsAt: number;
  bounceStartedAt: number;
  bounceEndsAt: number;
  deathType: CoinRushDeathType;
  diedAt: number;
  score: number;
  roundWins: number;
  totalCoins: number;
  deaths: number;
  /** Deaths during the current round only; used for simultaneous-threshold ties. */
  roundDeaths: number;
  suddenDeathEligible: boolean;
  lastAcceptedSequence: number;
  seenSequences: Set<number>;
}

export interface RuntimeRow {
  row: number;
  terrain: CoinRushTerrain;
  direction: -1 | 0 | 1;
  speed: number;
  vehicleLength: number;
  spacing: number;
  offset: number;
}

export interface RuntimeCoin {
  value: 1 | 3 | 5;
  col: number;
  row: number;
  visibleAt: number;
}

export interface RuntimeResultEntry {
  sessionId: string;
  rank: number;
  roundWins: number;
  totalCoins: number;
  deaths: number;
  label: string;
}

export interface RuntimeResult {
  winnerSessionIds: string[];
  leaderboard: RuntimeResultEntry[];
}

export interface PendingMove {
  sequence: number;
  direction: CoinRushDirection;
}

export interface CoinRushSettings {
  e2eMode: boolean;
  countdownMs: number;
  roundResultMs: number;
  moveDurationMs: number;
  pushDurationMs: number;
  bounceDurationMs: number;
  coinPopMs: number;
  deathAnimationMs: number;
  respawnCooldownMs: number;
  movesPerSecond: number;
}

/**
 * Authoritative, server-only Coin Rush runtime. Hidden fields (seed, RNG,
 * pending moves, sequence windows, rate-limit state, respawn rolls and
 * sudden-death resolution state) live here and are projected to the
 * synchronized schema by sync.ts.
 */
export interface CoinRushRuntime {
  phase: CoinRushPhase;
  totalRounds: number;
  roundNumber: number;
  countdownEndsAt: number;
  roundResultEndsAt: number;
  elapsedMs: number;
  lastTickAt: number;
  suddenDeath: boolean;
  seed: string;
  rng: () => number;
  rows: RuntimeRow[];
  players: Map<string, RuntimePlayer>;
  coins: Map<string, RuntimeCoin>;
  pendingMoves: Map<string, PendingMove>;
  roundWinnerSessionIds: string[];
  result: RuntimeResult | null;
  settings: CoinRushSettings;
}
