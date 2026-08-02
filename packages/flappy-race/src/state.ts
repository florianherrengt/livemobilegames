import { ArraySchema, MapSchema, type } from "@colyseus/schema";

import { PlatformPlayerState, PlatformState } from "@falling-platforms/platform-schema";

import type { FlappyRacePhase } from "./types.js";

export class FlappyRacePlayerState extends PlatformPlayerState {
  @type("string") color = "";
  @type("number") roundWins = 0;
  @type("number") clearedObstacleCount = 0;
  @type("boolean") roundActive = false;
  @type("boolean") eliminated = false;
  /** Dropped mid-match: spectates the rest of the match. */
  @type("boolean") matchRemoved = false;
  @type("number") birdY = 0;
  @type("number") birdVy = 0;
}

export class FlappyRaceState extends PlatformState {
  @type("string") phase: FlappyRacePhase = "lobby";
  @type("number") roundNumber = 0;
  @type("number") totalRounds = 0;
  /** Absolute epoch ms when the countdown ends; 0 outside countdown. */
  @type("number") countdownEndsAt = 0;
  /** Absolute epoch ms when course movement starts; 0 outside running. */
  @type("number") roundStartedAt = 0;
  /** Authoritative course elapsed ms since the round began moving. */
  @type("number") courseElapsedMs = 0;
  /** Absolute epoch ms when the round-result screen advances. */
  @type("number") resultsEndsAt = 0;
  @type("string") courseSeed = "";
  /** Authoritative course speed (px/s) for the current match. */
  @type("number") courseSpeed = 0;
  @type(["number"]) obstacleOpenings = new ArraySchema<number>();
  @type(["string"]) roundWinnerSessionIds = new ArraySchema<string>();
  @type({ map: FlappyRacePlayerState })
  players = new MapSchema<FlappyRacePlayerState>();

  /** Non-synchronized server-side runtime, never encoded. */
  runtime: unknown = null;
}

export interface FlappyRaceClientPlayer {
  name: string;
  connectionStatus: "connected" | "reconnecting" | "disconnected";
  isHost: boolean;
  isReady: boolean;
  joinedOrder: number;
  color: string;
  roundWins: number;
  clearedObstacleCount: number;
  roundActive: boolean;
  eliminated: boolean;
  matchRemoved: boolean;
  birdY: number;
  birdVy: number;
}

export interface FlappyRaceClientState {
  roomCode: string;
  gameId: string;
  status: "lobby" | "running" | "finished" | "closed";
  hostSessionId: string;
  minPlayers: number;
  requiresReady: boolean;
  phase: FlappyRacePhase;
  roundNumber: number;
  totalRounds: number;
  countdownEndsAt: number;
  roundStartedAt: number;
  courseElapsedMs: number;
  resultsEndsAt: number;
  courseSeed: string;
  courseSpeed: number;
  obstacleOpenings: number[];
  roundWinnerSessionIds: string[];
  players: Map<string, FlappyRaceClientPlayer>;
  result: {
    winnerSessionIds: string[];
    leaderboard: Array<{
      sessionId: string;
      rank: number;
      primaryScore: number;
      label: string;
      secondaryLabel?: string | undefined;
    }>;
    finishedAt: number;
  } | null;
}
