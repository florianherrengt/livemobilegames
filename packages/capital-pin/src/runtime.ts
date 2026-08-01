import type { Capital, Guess, RoundResult, Score } from "./types.js";

/**
 * The active round. Lives only on the server: the capital's coordinates and
 * every guess are secret until the round ends. Never synced.
 */
export interface RuntimeRound {
  roundNumber: number;
  capital: Capital;
  startedAt: number;
  endsAt: number;
  guesses: Map<string, Guess>;
  finished: boolean;
}

/**
 * Authoritative, server-only game state. The synchronized schema is a derived
 * projection of this (see sync.ts). Mirrors the runtime/sync split used by the
 * Falling Platforms game.
 */
export interface CapitalPinRuntime {
  phase: "lobby" | "round" | "round-results" | "finished";
  /** Session ids frozen at game start (participants). */
  participantIds: string[];
  /** Pre-selected capitals, one per round. */
  capitals: Capital[];
  totalRounds: number;
  /** Index into `capitals` of the next round to start. */
  nextRoundIndex: number;
  currentRound: RuntimeRound | null;
  /** The most recently completed round (revealed to clients). */
  lastResult: RoundResult | null;
  scores: Map<string, Score>;
}

export function createRuntime(): CapitalPinRuntime {
  return {
    phase: "lobby",
    participantIds: [],
    capitals: [],
    totalRounds: 0,
    nextRoundIndex: 0,
    currentRound: null,
    lastResult: null,
    scores: new Map(),
  };
}

/** True when every connected participant has locked a guess. */
export function allConnectedParticipantsSubmitted(
  runtime: CapitalPinRuntime,
  connectedSessionIds: ReadonlySet<string>,
): boolean {
  const round = runtime.currentRound;
  if (!round) return false;
  for (const sessionId of runtime.participantIds) {
    if (!connectedSessionIds.has(sessionId)) continue;
    if (!round.guesses.has(sessionId)) return false;
  }
  return true;
}
