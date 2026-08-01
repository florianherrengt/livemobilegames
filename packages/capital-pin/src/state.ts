import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

import { PlatformPlayerState, PlatformState } from "@falling-platforms/platform-schema";

export type CapitalPinPhase = "lobby" | "round" | "round-results" | "finished";

export class CapitalPinPlayerState extends PlatformPlayerState {
  /** Round wins accumulated across the game. */
  @type("number") roundWins = 0;
  /** Total guess distance accumulated (lower is better). */
  @type("number") totalDistanceKm = 0;
  /** True once the player has locked their guess for the active round. */
  @type("boolean") submitted = false;
}

/**
 * One player's revealed guess in a finished round. Only synced after the round
 * ends, never during it.
 */
export class GuessResultState extends Schema {
  @type("string") sessionId = "";
  @type("string") displayName = "";
  @type("number") latitude = 0;
  @type("number") longitude = 0;
  @type("number") distanceKm = 0;
  @type("boolean") isWinner = false;
}

/**
 * The result of a finished round: the capital (now with its coordinates) plus
 * every player's revealed guess. Synced only while phase is "round-results"
 * (and retained as the last result on "finished").
 */
export class RoundResultState extends Schema {
  @type("number") roundNumber = 0;
  @type("string") capitalName = "";
  @type("string") country = "";
  @type("number") correctLatitude = 0;
  @type("number") correctLongitude = 0;
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([GuessResultState]) guesses = new ArraySchema<GuessResultState>();
}

/**
 * Synchronized room state.
 *
 * The active round never exposes the capital's coordinates, country, or other
 * players' guesses — only its name. Those are revealed through `lastResult`
 * once the round ends. This is the structural data-leak guarantee.
 */
export class CapitalPinState extends PlatformState {
  @type("string") phase: CapitalPinPhase = "lobby";
  @type("number") roundNumber = 0;
  @type("number") totalRounds = 0;
  /** Absolute epoch ms when the active round ends. 0 when not in a round. */
  @type("number") roundEndsAt = 0;
  /** Absolute epoch ms when the results screen advances. 0 unless in round-results. */
  @type("number") resultsEndsAt = 0;
  /** Capital name for the active round. "" outside a round. */
  @type("string") currentCapitalName = "";
  /** Most recently completed round, revealed once it ends. Null until then. */
  @type(RoundResultState) lastResult: RoundResultState | null = null;
  @type({ map: CapitalPinPlayerState }) players = new MapSchema<CapitalPinPlayerState>();
}

// --- Client-facing read models (plain types, never instantiated as schemas) ---

export interface CapitalPinClientGuess {
  sessionId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  isWinner: boolean;
}

export interface CapitalPinClientRoundResult {
  roundNumber: number;
  capitalName: string;
  country: string;
  correctLatitude: number;
  correctLongitude: number;
  winnerSessionIds: string[];
  guesses: CapitalPinClientGuess[];
}

export interface CapitalPinClientPlayer {
  name: string;
  connectionStatus: "connected" | "reconnecting" | "disconnected";
  isHost: boolean;
  isReady: boolean;
  roundWins: number;
  totalDistanceKm: number;
  submitted: boolean;
}

export interface CapitalPinClientState {
  roomCode: string;
  gameId: string;
  status: "lobby" | "running" | "finished" | "closed";
  hostSessionId: string;
  phase: CapitalPinPhase;
  roundNumber: number;
  totalRounds: number;
  roundEndsAt: number;
  resultsEndsAt: number;
  currentCapitalName: string;
  lastResult: CapitalPinClientRoundResult | null;
  result: {
    winnerSessionIds: string[];
    leaderboard: Array<{
      sessionId: string;
      rank: number;
      primaryScore: number;
      label: string;
    }>;
    finishedAt: number;
  } | null;
  players: Map<string, CapitalPinClientPlayer>;
}
