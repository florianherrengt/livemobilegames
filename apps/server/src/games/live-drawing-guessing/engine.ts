import {
  LIVE_DRAWING_GUESSING_GAME_ID,
  type LiveDrawingGuessingPhase,
} from "@phone-party/protocol";

import { LIVE_DRAWING_GUESSING_SERVER_CONSTANTS } from "./constants.js";
import { createCryptoIntRng, createSeededIntRng, type IntRng, shuffle } from "./rng.js";
import {
  buildLetterPattern,
  letterCount,
  WORD_POOL,
  type WordCategory,
  type WordEntry,
} from "./words.js";

export type { LiveDrawingGuessingPhase };

export type LiveDrawingTurnOutcome = "solved" | "timeout" | "skipped" | "no-guessers";

export interface LiveDrawingSettings {
  config: typeof LIVE_DRAWING_GUESSING_SERVER_CONSTANTS;
  e2eMode: boolean;
  preparationMs: number;
  turnDurationMs: number;
  resultMs: number;
  roundSummaryMs: number;
  drawerHoldMs: number;
  rng: IntRng;
  wordRng: IntRng;
}

/** Server-only authoritative player state. Never encoded into the schema. */
export interface RuntimePlayer {
  playerId: string;
  sessionId: string;
  name: string;
  isHost: boolean;
  joinedOrder: number;
  connected: boolean;
  /** True while a dropped socket is inside Colyseus reconnection grace. */
  reconnecting: boolean;
  score: number;
  /** True for players who joined after the current match began. */
  isSpectator: boolean;
}

export interface TurnResultRecord {
  word: string;
  category: WordCategory;
  outcome: LiveDrawingTurnOutcome;
  drawerPlayerId: string;
  winnerPlayerId: string;
}

export interface RevealState {
  /** Shuffled alphabetical letter positions; fixed for the whole turn. */
  positions: number[];
  /** Number of positions revealed so far. */
  nextIndex: number;
  /** Absolute epoch ms of the next reveal; paused turns shift this forward. */
  nextRevealAt: number;
  /** Fixed reveal interval for this turn. */
  intervalMs: number;
}

export interface LeaderboardEntry {
  playerId: string;
  rank: number;
  score: number;
  label: string;
}

export interface MatchResult {
  winnerPlayerIds: string[];
  leaderboard: LeaderboardEntry[];
}

/**
 * Authoritative, server-only Live Drawing and Guessing runtime. Hidden data
 * (the current word, reveal order, word deck, deadlines, hold state, and
 * scoring internals) lives here and is projected to the synchronized schema
 * by sync.ts. The schema never contains the word until a turn ends.
 */
export interface LiveDrawingRuntime {
  phase: LiveDrawingGuessingPhase;
  roundNumber: number;
  turnNumber: number;
  totalRounds: number;
  totalTurns: number;
  turnIndex: number;
  order: string[];
  drawerPlayerId: string;
  word: string;
  category: WordCategory;
  pattern: string[];
  reveal: RevealState | null;
  prepareEndsAt: number;
  drawingEndsAt: number;
  resultEndsAt: number;
  roundSummaryEndsAt: number;
  drawerHoldUntil: number;
  pausedAt: number;
  lastResult: TurnResultRecord | null;
  result: MatchResult | null;
  players: Map<string, RuntimePlayer>;
  wordDeck: WordEntry[];
  settings: LiveDrawingSettings;
}

export function createSettings(e2eMode: boolean, turnDurationMs?: number): LiveDrawingSettings {
  const constants = LIVE_DRAWING_GUESSING_SERVER_CONSTANTS;
  return {
    config: constants,
    e2eMode,
    preparationMs: e2eMode ? constants.E2E_PREPARATION_MS : constants.PREPARATION_MS,
    turnDurationMs: e2eMode
      ? (turnDurationMs ?? constants.E2E_TURN_DURATION_MS)
      : constants.TURN_DURATION_MS,
    resultMs: e2eMode ? constants.E2E_RESULT_MS : constants.RESULT_MS,
    roundSummaryMs: e2eMode ? constants.E2E_ROUND_SUMMARY_MS : constants.ROUND_SUMMARY_MS,
    drawerHoldMs: e2eMode ? constants.E2E_DRAWER_HOLD_MS : constants.DRAWER_DISCONNECT_HOLD_MS,
    rng: e2eMode ? createSeededIntRng(constants.E2E_ORDER_SEED) : createCryptoIntRng(),
    wordRng: e2eMode ? createSeededIntRng(constants.E2E_WORD_SEED) : createCryptoIntRng(),
  };
}

export function createRuntime(settings: LiveDrawingSettings): LiveDrawingRuntime {
  return {
    phase: "lobby",
    roundNumber: 0,
    turnNumber: 0,
    totalRounds: 0,
    totalTurns: 0,
    turnIndex: 0,
    order: [],
    drawerPlayerId: "",
    word: "",
    category: "Animal",
    pattern: [],
    reveal: null,
    prepareEndsAt: 0,
    drawingEndsAt: 0,
    resultEndsAt: 0,
    roundSummaryEndsAt: 0,
    drawerHoldUntil: 0,
    pausedAt: 0,
    lastResult: null,
    result: null,
    players: new Map(),
    wordDeck: [],
    settings,
  };
}

export function createRuntimePlayer(
  playerId: string,
  sessionId: string,
  name: string,
  isHost: boolean,
  joinedOrder: number,
): RuntimePlayer {
  return {
    playerId,
    sessionId,
    name,
    isHost,
    joinedOrder,
    connected: true,
    reconnecting: false,
    score: 0,
    isSpectator: false,
  };
}

export function gameId(): string {
  return LIVE_DRAWING_GUESSING_GAME_ID;
}

/**
 * Start a fresh match with the given connected participants. The drawing
 * order is randomised once and reused for all three rounds; the word deck is
 * shuffled once and drawn without replacement.
 */
export function startMatch(runtime: LiveDrawingRuntime, now: number): void {
  const participants = [...runtime.players.values()].filter((player) => player.connected);
  if (participants.length < runtime.settings.config.MIN_PLAYERS) {
    throw new Error("Not enough connected players to start a match");
  }
  if (participants.length > runtime.settings.config.MAX_PLAYERS) {
    throw new Error("Too many connected players to start a match");
  }

  runtime.order = shuffle(
    [...participants].map((player) => player.playerId),
    runtime.settings.rng,
  );
  runtime.totalRounds = runtime.settings.config.TOTAL_ROUNDS;
  runtime.totalTurns = runtime.order.length * runtime.settings.config.TOTAL_ROUNDS;
  runtime.result = null;
  runtime.wordDeck = shuffle([...WORD_POOL], runtime.settings.wordRng);

  for (const player of runtime.players.values()) {
    player.score = 0;
    player.isSpectator = false;
  }

  beginTurn(runtime, now, 0);
}

/**
 * Set up the drawing turn at `turnIndex`. Returns true when the preparation
 * countdown should run; returns false when the drawer is already disconnected
 * and the turn is skipped immediately.
 */
export function beginTurn(runtime: LiveDrawingRuntime, now: number, turnIndex: number): boolean {
  const participantCount = runtime.order.length;
  if (participantCount === 0) {
    finishMatch(runtime);
    return false;
  }
  if (turnIndex >= runtime.totalTurns) {
    finishMatch(runtime);
    return false;
  }

  runtime.turnIndex = turnIndex;
  runtime.turnNumber = turnIndex + 1;
  runtime.roundNumber = Math.floor(turnIndex / participantCount) + 1;
  runtime.drawerPlayerId = runtime.order[turnIndex % participantCount] ?? "";
  runtime.lastResult = null;
  runtime.reveal = null;
  runtime.drawerHoldUntil = 0;
  runtime.pausedAt = 0;
  runtime.prepareEndsAt = 0;
  runtime.drawingEndsAt = 0;

  const entry = drawWord(runtime);
  runtime.word = entry.word;
  runtime.category = entry.category;
  runtime.pattern = buildLetterPattern(entry.word);

  const drawer = runtime.players.get(runtime.drawerPlayerId);
  if (drawer?.connected === true) {
    runtime.phase = "preparing";
    runtime.prepareEndsAt = now + runtime.settings.preparationMs;
    return true;
  }

  resolveTurn(runtime, now, "skipped", "");
  return false;
}

/** Activate drawing, the guess input, and the progressive letter reveals. */
export function beginDrawing(runtime: LiveDrawingRuntime, now: number): void {
  runtime.phase = "drawing";
  runtime.drawingEndsAt = now + runtime.settings.turnDurationMs;

  const letters = letterCount(runtime.word);
  const intervalMs = revealIntervalMs(runtime.settings.turnDurationMs, letters);
  runtime.reveal = {
    positions: shuffle(range(letters), runtime.settings.rng),
    nextIndex: 0,
    nextRevealAt: now + intervalMs,
    intervalMs,
  };
  runtime.pattern = buildLetterPattern(runtime.word);
}

/**
 * Reveal one letter after every interval, stopping after the final letter so
 * players still have to submit the answer. The reveal order stays fixed for
 * the whole turn.
 */
export function advanceReveals(runtime: LiveDrawingRuntime, now: number): void {
  const reveal = runtime.reveal;
  if (reveal === null || runtime.phase !== "drawing" || runtime.pausedAt !== 0) {
    return;
  }
  const maxReveals = Math.max(0, reveal.positions.length - 1);
  while (reveal.nextIndex < maxReveals && now >= reveal.nextRevealAt) {
    const position = reveal.positions[reveal.nextIndex];
    if (position !== undefined) {
      revealPatternPosition(runtime, position);
    }
    reveal.nextIndex += 1;
    reveal.nextRevealAt += reveal.intervalMs;
  }
}

export function resolveTurn(
  runtime: LiveDrawingRuntime,
  now: number,
  outcome: LiveDrawingTurnOutcome,
  winnerPlayerId: string,
): void {
  runtime.phase = "result";
  runtime.resultEndsAt = now + runtime.settings.resultMs;
  runtime.reveal = null;
  runtime.drawerHoldUntil = 0;
  runtime.pausedAt = 0;
  runtime.prepareEndsAt = 0;
  runtime.drawingEndsAt = 0;

  if (outcome === "solved") {
    const winner = runtime.players.get(winnerPlayerId);
    const drawer = runtime.players.get(runtime.drawerPlayerId);
    if (winner !== undefined && !winner.isSpectator) {
      winner.score += 1;
    }
    if (drawer !== undefined && !drawer.isSpectator) {
      drawer.score += 1;
    }
  }

  runtime.lastResult = {
    word: runtime.word,
    category: runtime.category,
    outcome,
    drawerPlayerId: runtime.drawerPlayerId,
    winnerPlayerId: outcome === "solved" ? winnerPlayerId : "",
  };
}

/** Advance after the result screen: next turn, round summary, or final board. */
export function advanceAfterResult(runtime: LiveDrawingRuntime, now: number): void {
  runtime.turnIndex += 1;
  if (runtime.turnIndex >= runtime.totalTurns) {
    finishMatch(runtime);
    return;
  }
  const participantCount = runtime.order.length;
  if (runtime.turnIndex % participantCount === 0) {
    runtime.phase = "round-summary";
    runtime.roundSummaryEndsAt = now + runtime.settings.roundSummaryMs;
    return;
  }
  beginTurn(runtime, now, runtime.turnIndex);
}

/** Start the up-to-five-second hold when the current drawer disconnects. */
export function startDrawerHold(runtime: LiveDrawingRuntime, now: number): void {
  if (
    (runtime.phase !== "preparing" && runtime.phase !== "drawing") ||
    runtime.drawerHoldUntil !== 0
  ) {
    return;
  }
  runtime.pausedAt = now;
  runtime.drawerHoldUntil = now + runtime.settings.drawerHoldMs;
}

/** Resume the held turn, shifting every deadline by the pause duration. */
export function resumeDrawerHold(runtime: LiveDrawingRuntime, now: number): void {
  if (runtime.drawerHoldUntil === 0) {
    return;
  }
  const pauseMs = Math.max(0, now - runtime.pausedAt);
  if (runtime.phase === "preparing" && runtime.prepareEndsAt !== 0) {
    runtime.prepareEndsAt += pauseMs;
  }
  if (runtime.phase === "drawing" && runtime.drawingEndsAt !== 0) {
    runtime.drawingEndsAt += pauseMs;
    if (runtime.reveal !== null) {
      runtime.reveal.nextRevealAt += pauseMs;
    }
  }
  runtime.pausedAt = 0;
  runtime.drawerHoldUntil = 0;
}

/** The drawer did not reconnect inside the hold window: skip the turn. */
export function expireDrawerHold(runtime: LiveDrawingRuntime, now: number): void {
  if (runtime.drawerHoldUntil === 0) {
    return;
  }
  resolveTurn(runtime, now, "skipped", "");
}

/** Connected, non-spectator guessers for the current turn. */
export function connectedGuesserCount(runtime: LiveDrawingRuntime): number {
  let count = 0;
  for (const player of runtime.players.values()) {
    if (player.isSpectator || player.playerId === runtime.drawerPlayerId) {
      continue;
    }
    if (player.connected) {
      count += 1;
    }
  }
  return count;
}

export function finishMatch(runtime: LiveDrawingRuntime): void {
  runtime.phase = "finished";
  runtime.prepareEndsAt = 0;
  runtime.drawingEndsAt = 0;
  runtime.resultEndsAt = 0;
  runtime.roundSummaryEndsAt = 0;
  runtime.reveal = null;
  runtime.drawerHoldUntil = 0;
  runtime.pausedAt = 0;
  runtime.result = buildMatchResult(runtime);
}

export function normalizeGuess(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

export function matchesAnswer(guess: string, answer: string): boolean {
  return normalizeGuess(guess) === normalizeGuess(answer);
}

export function revealIntervalMs(turnDurationMs: number, letters: number): number {
  if (letters <= 0) {
    return 0;
  }
  return turnDurationMs / letters;
}

/**
 * Build the final result. Standard competition ranking by score; every player
 * with the maximum score is a joint winner. Disconnected participants keep
 * their scores and stay on the board; spectators never enter it.
 */
export function buildMatchResult(runtime: LiveDrawingRuntime): MatchResult {
  const entries = [...runtime.players.values()]
    .filter((player) => !player.isSpectator)
    .map((player) => ({
      playerId: player.playerId,
      score: player.score,
      label: player.name,
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "en"));

  const leaderboard: LeaderboardEntry[] = entries.reduce((acc, entry, index) => {
    const previous = acc[acc.length - 1];
    const rank =
      previous !== undefined && previous.score === entry.score ? previous.rank : index + 1;
    acc.push({ playerId: entry.playerId, rank, score: entry.score, label: entry.label });
    return acc;
  }, [] as LeaderboardEntry[]);

  const maxScore = leaderboard[0]?.score ?? 0;
  return {
    winnerPlayerIds: leaderboard
      .filter((entry) => entry.score === maxScore)
      .map((entry) => entry.playerId),
    leaderboard,
  };
}

function drawWord(runtime: LiveDrawingRuntime): WordEntry {
  if (runtime.wordDeck.length === 0) {
    // The pool was exhausted mid-match; reshuffle a fresh deck rather than
    // repeating words unnecessarily.
    runtime.wordDeck = shuffle([...WORD_POOL], runtime.settings.wordRng);
  }
  const entry = runtime.wordDeck.pop();
  if (entry === undefined) {
    throw new Error("Word pool is empty");
  }
  return entry;
}

function revealPatternPosition(runtime: LiveDrawingRuntime, letterPosition: number): void {
  let letterIndex = 0;
  for (let index = 0; index < runtime.word.length; index += 1) {
    const char = runtime.word[index];
    if (char === undefined || !/[A-Za-z]/.test(char)) {
      continue;
    }
    if (letterIndex === letterPosition) {
      runtime.pattern[index] = char.toUpperCase();
      return;
    }
    letterIndex += 1;
  }
}

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}
