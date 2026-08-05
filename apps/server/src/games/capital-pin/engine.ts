import {
  applyRoundResultToScores,
  buildMatchResult,
  buildRoundResult,
  type LeaderboardEntry,
} from "./scoring.js";
import { type RandomSource, selectUniqueCapitals } from "./selection.js";
import { type Capital, emptyScore, type Guess, type RoundResult, type Score } from "./types.js";

export type EnginePhase = "lobby" | "round" | "round-results" | "finished";

export interface ActiveRound {
  roundNumber: number;
  capital: Capital;
  endsAt: number;
  guesses: Map<string, Guess>;
  finished: boolean;
}

export type EngineErrorCode = "GAME_NOT_RUNNING" | "PLAYER_NOT_IN_ROOM" | "INVALID_GAME_COMMAND";

export interface MatchResult {
  winnerSessionIds: string[];
  leaderboard: LeaderboardEntry[];
  finishedAt: number;
}

export interface CapitalPinEngineOptions {
  totalRounds: number;
  roundDurationMs: number;
  resultsDurationMs: number;
  capitals: readonly Capital[];
  random?: RandomSource;
}

/**
 * Authoritative, server-only Capital Pin state machine. It owns hidden state
 * (capitals, guesses, scores, winner calculations) that must never reach the
 * synchronized schema directly; the room projects it through sync.ts. Timers
 * are owned by the Colyseus room, which calls the phase-advance methods here.
 */
export class CapitalPinEngine {
  phase: EnginePhase = "lobby";
  participantIds: string[] = [];
  totalRounds = 0;
  currentRound: ActiveRound | null = null;
  lastResult: RoundResult | null = null;
  scores = new Map<string, Score>();
  result: MatchResult | null = null;
  roundEndsAt = 0;
  resultsEndsAt = 0;

  #capitals: Capital[] = [];
  #nextRoundIndex = 0;
  readonly #now: () => number;
  readonly #options: CapitalPinEngineOptions;
  #displayNameOf: (sessionId: string) => string = () => "Unknown";

  constructor(now: () => number, options: CapitalPinEngineOptions) {
    this.#now = now;
    this.#options = options;
  }

  start(participantIds: readonly string[], displayNameOf: (sessionId: string) => string): void {
    this.#displayNameOf = displayNameOf;
    this.participantIds = [...participantIds];
    this.scores = new Map(this.participantIds.map((id) => [id, emptyScore()]));
    this.totalRounds = this.#options.totalRounds;
    this.#capitals = selectUniqueCapitals(
      this.#options.capitals,
      this.totalRounds,
      this.#options.random,
    );
    this.#nextRoundIndex = 0;
    this.currentRound = null;
    this.lastResult = null;
    this.result = null;
    this.startNextRound();
  }

  startNextRound(): void {
    if (this.#nextRoundIndex >= this.#capitals.length) {
      this.finish();
      return;
    }
    const capital = this.#capitals[this.#nextRoundIndex];
    if (!capital) {
      this.finish();
      return;
    }
    const roundNumber = this.#nextRoundIndex + 1;
    const endsAt = this.#now() + this.#options.roundDurationMs;
    this.currentRound = {
      roundNumber,
      capital,
      endsAt,
      guesses: new Map(),
      finished: false,
    };
    this.#nextRoundIndex += 1;
    this.phase = "round";
    this.roundEndsAt = endsAt;
    this.resultsEndsAt = 0;
  }

  /**
   * Validate and store a guess. Returns a stable room error code on failure,
   * or null when the guess was accepted. The actor is already derived from the
   * connected client by the room; this method never trusts a client-supplied
   * session id.
   */
  submit(
    sessionId: string,
    roundNumber: number,
    latitude: number,
    longitude: number,
  ): EngineErrorCode | null {
    const round = this.currentRound;
    if (this.phase !== "round" || !round || round.finished) {
      return "GAME_NOT_RUNNING";
    }
    if (!this.participantIds.includes(sessionId)) {
      return "PLAYER_NOT_IN_ROOM";
    }
    if (round.roundNumber !== roundNumber) {
      return "GAME_NOT_RUNNING";
    }
    if (this.#now() > round.endsAt) {
      return "GAME_NOT_RUNNING";
    }
    if (round.guesses.has(sessionId)) {
      return "INVALID_GAME_COMMAND";
    }
    round.guesses.set(sessionId, {
      sessionId,
      latitude,
      longitude,
      submittedAt: this.#now(),
    });
    return null;
  }

  allConnectedParticipantsSubmitted(connectedSessionIds: ReadonlySet<string>): boolean {
    const round = this.currentRound;
    if (this.phase !== "round" || !round || round.finished) {
      return false;
    }
    for (const sessionId of this.participantIds) {
      if (!connectedSessionIds.has(sessionId)) {
        continue;
      }
      if (!round.guesses.has(sessionId)) {
        return false;
      }
    }
    return true;
  }

  endRound(): void {
    const round = this.currentRound;
    if (!round || round.finished) {
      return;
    }
    round.finished = true;
    this.lastResult = buildRoundResult(
      this.participantIds,
      round.capital,
      round.roundNumber,
      round.guesses,
      this.#displayNameOf,
    );
    applyRoundResultToScores(this.scores, this.lastResult);
    this.phase = "round-results";
    this.roundEndsAt = 0;
    this.resultsEndsAt = this.#now() + this.#options.resultsDurationMs;
  }

  advanceFromResults(): void {
    if (this.phase !== "round-results") {
      return;
    }
    this.currentRound = null;
    this.roundEndsAt = 0;
    this.resultsEndsAt = 0;
    this.startNextRound();
  }

  finish(): void {
    this.phase = "finished";
    this.currentRound = null;
    this.roundEndsAt = 0;
    this.resultsEndsAt = 0;
    this.result = buildMatchResult(
      this.participantIds,
      this.scores,
      this.#displayNameOf,
      this.#now(),
    );
  }

  reset(): void {
    this.phase = "lobby";
    this.participantIds = [];
    this.#capitals = [];
    this.totalRounds = 0;
    this.#nextRoundIndex = 0;
    this.currentRound = null;
    this.lastResult = null;
    this.scores = new Map();
    this.result = null;
    this.roundEndsAt = 0;
    this.resultsEndsAt = 0;
  }

  onPlayerRemoved(sessionId: string): void {
    this.currentRound?.guesses.delete(sessionId);
    this.scores.delete(sessionId);
    this.participantIds = this.participantIds.filter((id) => id !== sessionId);
  }
}
