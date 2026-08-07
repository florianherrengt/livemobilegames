import { describe, expect, it } from "vitest";

import { LIVE_DRAWING_GUESSING_SERVER_CONSTANTS } from "../../../src/games/live-drawing-guessing/constants.js";
import {
  advanceAfterResult,
  advanceReveals,
  beginDrawing,
  beginTurn,
  buildMatchResult,
  connectedGuesserCount,
  createRuntime,
  createRuntimePlayer,
  expireDrawerHold,
  type LiveDrawingRuntime,
  type LiveDrawingSettings,
  matchesAnswer,
  normalizeGuess,
  resolveTurn,
  resumeDrawerHold,
  revealIntervalMs,
  startDrawerHold,
  startMatch,
} from "../../../src/games/live-drawing-guessing/engine.js";
import { createSeededIntRng } from "../../../src/games/live-drawing-guessing/rng.js";
import { WORD_POOL } from "../../../src/games/live-drawing-guessing/words.js";

function testSettings(): LiveDrawingSettings {
  const config = LIVE_DRAWING_GUESSING_SERVER_CONSTANTS;
  return {
    config,
    e2eMode: false,
    preparationMs: 3_000,
    turnDurationMs: 60_000,
    resultMs: 3_000,
    roundSummaryMs: 3_000,
    drawerHoldMs: 5_000,
    rng: createSeededIntRng("engine-unit-rng"),
    wordRng: createSeededIntRng("engine-unit-words"),
  };
}

function runtimeWithPlayers(settings: LiveDrawingSettings, names: string[]): LiveDrawingRuntime {
  const runtime = createRuntime(settings);
  names.forEach((name, index) => {
    runtime.players.set(
      `player-${index}`,
      createRuntimePlayer(`player-${index}`, `session-${index}`, name, index === 0, index),
    );
  });
  return runtime;
}

function startTwoPlayerMatch(): LiveDrawingRuntime {
  const runtime = runtimeWithPlayers(testSettings(), ["Alice", "Bob"]);
  startMatch(runtime, 1_000);
  return runtime;
}

describe("match start and turn order", () => {
  it("starts a match with every connected player and three rounds per player", () => {
    const runtime = startTwoPlayerMatch();
    expect(runtime.totalRounds).toBe(3);
    expect(runtime.totalTurns).toBe(6);
    expect(runtime.order).toHaveLength(2);
    expect(runtime.phase).toBe("preparing");
    expect(runtime.turnNumber).toBe(1);
    expect(runtime.roundNumber).toBe(1);
    expect(runtime.drawerPlayerId).toBe(runtime.order[0]);
    expect(runtime.lastResult).toBeNull();
    for (const player of runtime.players.values()) {
      expect(player.score).toBe(0);
      expect(player.isSpectator).toBe(false);
    }
  });

  it("uses the same random order for every round", () => {
    const runtime = startTwoPlayerMatch();
    const order = [...runtime.order];
    expect(new Set(order).size).toBe(2);
    const drawers: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      drawers.push(runtime.drawerPlayerId);
      resolveTurn(runtime, 100_000 + index * 100_000, "timeout", "");
      advanceAfterResult(runtime, 200_000 + index * 100_000);
      if (runtime.phase === "round-summary") {
        beginTurn(runtime, 300_000 + index * 100_000, runtime.turnIndex);
      }
      expect(runtime.order).toEqual(order);
    }
    expect(drawers).toEqual([...order, ...order, ...order]);
  });

  it("skips a turn immediately when the drawer is disconnected", () => {
    const runtime = runtimeWithPlayers(testSettings(), ["Alice", "Bob"]);
    startMatch(runtime, 1_000);
    const secondDrawer = runtime.order[1];
    if (secondDrawer === undefined) {
      throw new Error("Expected a second drawer");
    }
    const secondPlayer = runtime.players.get(secondDrawer);
    if (secondPlayer === undefined) {
      throw new Error("Expected the second player");
    }
    secondPlayer.connected = false;
    resolveTurn(runtime, 4_000, "timeout", "");
    advanceAfterResult(runtime, 7_000);
    expect(runtime.phase).toBe("result");
    expect(runtime.lastResult?.outcome).toBe("skipped");
    expect(runtime.lastResult?.drawerPlayerId).toBe(secondDrawer);
    expect(runtime.players.get(secondDrawer)?.score).toBe(0);
  });

  it("reshuffles the word deck when it is exhausted mid-match", () => {
    const runtime = startTwoPlayerMatch();
    runtime.wordDeck = [];
    expect(beginTurn(runtime, 50_000, 0)).toBe(true);
    expect(runtime.word).not.toBe("");
    expect(WORD_POOL.some((entry) => entry.word === runtime.word)).toBe(true);
  });
});

describe("letter reveals", () => {
  it("reveals one letter per interval and stops before the final letter", () => {
    const runtime = startTwoPlayerMatch();
    const letters = runtime.word.replace(/[^A-Za-z]/g, "").length;
    expect(revealIntervalMs(60_000, letters)).toBeCloseTo(60_000 / letters, 5);
    beginDrawing(runtime, 10_000);
    const reveal = runtime.reveal;
    if (reveal === null) {
      throw new Error("Expected a reveal plan");
    }
    const plan = [...reveal.positions];
    expect(plan).toHaveLength(letters);
    expect(new Set(plan).size).toBe(letters);

    const interval = reveal.intervalMs;
    for (let index = 0; index < letters; index += 1) {
      advanceReveals(runtime, 10_000 + (index + 1) * interval + 1);
    }
    const revealed = runtime.pattern.filter((char) => /[A-Za-z]/.test(char)).length;
    expect(revealed).toBe(letters - 1);
    const hiddenIndex = plan[letters - 1];
    if (hiddenIndex === undefined) {
      throw new Error("Expected a hidden position");
    }
    expect(runtime.pattern[hiddenIndex]).toBe("_");
  });

  it("reveals repeated letters one position at a time", () => {
    const runtime = startTwoPlayerMatch();
    runtime.word = "banana";
    runtime.pattern = ["_", "_", "_", "_", "_", "_"];
    beginDrawing(runtime, 10_000);
    const reveal = runtime.reveal;
    if (reveal === null) {
      throw new Error("Expected a reveal plan");
    }
    reveal.positions = [1, 3, 0, 5, 2, 4];
    reveal.nextIndex = 0;
    reveal.nextRevealAt = 10_001;
    reveal.intervalMs = 10_000;
    advanceReveals(runtime, 10_001);
    expect(runtime.pattern).toEqual(["_", "A", "_", "_", "_", "_"]);
    advanceReveals(runtime, 20_001);
    expect(runtime.pattern).toEqual(["_", "A", "_", "A", "_", "_"]);
  });

  it("stops all reveals once the turn is resolved", () => {
    const runtime = startTwoPlayerMatch();
    beginDrawing(runtime, 10_000);
    resolveTurn(runtime, 10_500, "solved", "player-1");
    runtime.reveal = {
      positions: [0, 1, 2, 3, 4, 5],
      nextIndex: 0,
      nextRevealAt: 11_000,
      intervalMs: 10_000,
    };
    advanceReveals(runtime, 20_000);
    const reveal = runtime.reveal;
    if (reveal === null) {
      throw new Error("Expected a reveal plan");
    }
    expect(reveal.nextIndex).toBe(0);
  });
});

describe("guess matching", () => {
  it("normalises case, surrounding spaces, and repeated internal spaces", () => {
    expect(normalizeGuess("  Ice   Cream  ")).toBe("ice cream");
    expect(matchesAnswer("Ice  Cream", "ice cream")).toBe(true);
    expect(matchesAnswer("  GIRAFFE ", "giraffe")).toBe(true);
  });

  it("rejects aliases, missing words, plurals, and near-misses", () => {
    expect(matchesAnswer("icecream", "ice cream")).toBe(false);
    expect(matchesAnswer("cream", "ice cream")).toBe(false);
    expect(matchesAnswer("giraffes", "giraffe")).toBe(false);
    expect(matchesAnswer("girafe", "giraffe")).toBe(false);
    expect(matchesAnswer("long neck", "giraffe")).toBe(false);
  });
});

describe("scoring and results", () => {
  it("awards one point to the first correct guesser and the drawer only", () => {
    const runtime = runtimeWithPlayers(testSettings(), ["Alice", "Bob", "Carol"]);
    startMatch(runtime, 1_000);
    beginDrawing(runtime, 4_000);
    resolveTurn(runtime, 4_500, "solved", "player-2");
    expect(runtime.players.get("player-0")?.score).toBe(1);
    expect(runtime.players.get("player-1")?.score).toBe(0);
    expect(runtime.players.get("player-2")?.score).toBe(1);
    expect(runtime.lastResult?.winnerPlayerId).toBe("player-2");
    expect(runtime.lastResult?.outcome).toBe("solved");
  });

  it("awards no points on timeout, skip, or no-guessers", () => {
    for (const outcome of ["timeout", "skipped", "no-guessers"] as const) {
      const runtime = startTwoPlayerMatch();
      resolveTurn(runtime, 5_000, outcome, "");
      expect(runtime.players.get("player-0")?.score).toBe(0);
      expect(runtime.players.get("player-1")?.score).toBe(0);
      expect(runtime.lastResult?.winnerPlayerId).toBe("");
    }
  });

  it("accumulates scores across turns and computes joint winners", () => {
    const runtime = startTwoPlayerMatch();
    beginDrawing(runtime, 4_000);
    resolveTurn(runtime, 4_500, "solved", "player-1");
    advanceAfterResult(runtime, 7_500);
    beginDrawing(runtime, 10_500);
    resolveTurn(runtime, 11_000, "solved", "player-0");
    expect(runtime.players.get("player-0")?.score).toBe(2);
    expect(runtime.players.get("player-1")?.score).toBe(2);
    const result = buildMatchResult(runtime);
    expect(result.winnerPlayerIds.sort()).toEqual(["player-0", "player-1"]);
    expect(result.leaderboard.map((entry) => entry.rank)).toEqual([1, 1]);
  });

  it("excludes spectators from the final board", () => {
    const runtime = startTwoPlayerMatch();
    runtime.players.set(
      "spectator",
      createRuntimePlayer("spectator", "session-x", "Spectator", false, 9),
    );
    const spectator = runtime.players.get("spectator");
    if (spectator === undefined) {
      throw new Error("Expected the spectator");
    }
    spectator.isSpectator = true;
    beginDrawing(runtime, 4_000);
    resolveTurn(runtime, 4_500, "solved", "player-1");
    const result = buildMatchResult(runtime);
    expect(result.leaderboard).toHaveLength(2);
    expect(result.leaderboard.some((entry) => entry.playerId === "spectator")).toBe(false);
  });

  it("never awards points to a spectator", () => {
    const runtime = startTwoPlayerMatch();
    const spectator = createRuntimePlayer("spectator", "session-x", "Spectator", false, 9);
    spectator.isSpectator = true;
    runtime.players.set("spectator", spectator);
    beginDrawing(runtime, 4_000);
    resolveTurn(runtime, 4_500, "solved", "spectator");
    const drawerId = runtime.drawerPlayerId;
    expect(runtime.players.get("spectator")?.score).toBe(0);
    expect(runtime.players.get(drawerId)?.score).toBe(1);
    for (const player of runtime.players.values()) {
      if (player.playerId !== drawerId && player.playerId !== "spectator") {
        expect(player.score).toBe(0);
      }
    }
  });
});

describe("turn progression", () => {
  it("advances through turns, round summaries, and the final board", () => {
    const runtime = runtimeWithPlayers(testSettings(), ["Alice", "Bob"]);
    startMatch(runtime, 1_000);
    let now = 1_000;
    for (let turn = 1; turn <= 6; turn += 1) {
      now += 10_000;
      resolveTurn(runtime, now, "timeout", "");
      now += 10_000;
      advanceAfterResult(runtime, now);
      if (turn === 2 || turn === 4) {
        expect(runtime.phase).toBe("round-summary");
        now += 10_000;
        beginTurn(runtime, now, runtime.turnIndex);
      }
      if (turn < 6) {
        expect(runtime.phase).toBe("preparing");
        expect(runtime.turnNumber).toBe(turn + 1);
      }
    }
    expect(runtime.phase).toBe("finished");
    expect(runtime.result).not.toBeNull();
  });

  it("tracks the connected guesser count without spectators", () => {
    const runtime = runtimeWithPlayers(testSettings(), ["Alice", "Bob", "Carol"]);
    startMatch(runtime, 1_000);
    expect(connectedGuesserCount(runtime)).toBe(2);
    const bob = runtime.players.get("player-1");
    if (bob === undefined) {
      throw new Error("Expected Bob");
    }
    bob.connected = false;
    expect(connectedGuesserCount(runtime)).toBe(1);
    const spectator = createRuntimePlayer("spectator", "sx", "Spectator", false, 9);
    spectator.isSpectator = true;
    runtime.players.set("spectator", spectator);
    expect(connectedGuesserCount(runtime)).toBe(1);
  });
});

describe("drawer disconnect hold", () => {
  it("pauses deadlines and resumes them after reconnect", () => {
    const runtime = startTwoPlayerMatch();
    beginDrawing(runtime, 10_000);
    const deadline = runtime.drawingEndsAt;
    const reveal = runtime.reveal;
    if (reveal === null) {
      throw new Error("Expected a reveal plan");
    }
    const nextReveal = reveal.nextRevealAt;
    startDrawerHold(runtime, 12_000);
    expect(runtime.drawerHoldUntil).toBe(17_000);
    expect(runtime.pausedAt).toBe(12_000);
    resumeDrawerHold(runtime, 14_000);
    expect(runtime.drawerHoldUntil).toBe(0);
    expect(runtime.drawingEndsAt).toBe(deadline + 2_000);
    expect(reveal.nextRevealAt).toBe(nextReveal + 2_000);
  });

  it("skips the turn with no points when the hold expires", () => {
    const runtime = startTwoPlayerMatch();
    beginDrawing(runtime, 10_000);
    startDrawerHold(runtime, 12_000);
    expireDrawerHold(runtime, 17_000);
    expect(runtime.phase).toBe("result");
    expect(runtime.lastResult?.outcome).toBe("skipped");
    expect(runtime.players.get("player-0")?.score).toBe(0);
    expect(runtime.players.get("player-1")?.score).toBe(0);
  });
});
