import { PONG_CONSTANTS, paddleRect } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import {
  addPlayer,
  buildSettings,
  clampDirection,
  createRuntime,
  removePlayer,
  resetForNewMatch,
  startMatch,
  updatePong,
} from "../../../src/games/pong/engine.js";
import { buildPongSlots, shuffledPongSlots } from "../../../src/games/pong/layout.js";
import { createMatchRng } from "../../../src/games/pong/rng.js";
import type { PongRuntime } from "../../../src/games/pong/types.js";

const E2E = buildSettings({ e2eMode: true });

function runtimeWithPlayers(count: number): PongRuntime {
  const runtime = createRuntime(E2E);
  for (let index = 0; index < count; index++) {
    addPlayer(runtime, `session-${index}`, `Player ${index}`, index);
  }
  return runtime;
}

function start(runtime: PongRuntime, at = 1_000): void {
  expect(startMatch(runtime, at)).toBe(true);
}

function advance(runtime: PongRuntime, from: number, to: number, stepMs = 10): void {
  for (let now = from; now <= to; now += stepMs) {
    updatePong(runtime, now);
  }
}

/** Advances exactly N simulation steps from the runtime's current tick time. */
function runSteps(runtime: PongRuntime, steps: number): void {
  const base = runtime.lastTickAt;
  for (let index = 1; index <= steps; index++) {
    updatePong(runtime, base + index * 10);
  }
}

function movingBallAt(
  runtime: PongRuntime,
  id: string,
  x: number,
  y: number,
  vx: number,
  vy: number,
) {
  const ball = runtime.balls.get(id);
  if (!ball) {
    throw new Error(`missing ball ${id}`);
  }
  ball.x = x;
  ball.y = y;
  ball.vx = vx;
  ball.vy = vy;
  ball.state = "moving";
  ball.spawnsAt = 0;
}

function playersOn(runtime: PongRuntime, edge: "top" | "right" | "bottom" | "left") {
  return [...runtime.players.values()].filter((player) => player.worldEdge === edge);
}

describe("pong layout", () => {
  it("uses classic top/bottom arrangement for two players with solid sides", () => {
    const slots = buildPongSlots(2, createMatchRng("layout-2"));
    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.worldEdge).sort()).toEqual(["bottom", "top"]);
    const openingWidth = PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.TWO_PLAYER_GOAL_RATIO;
    for (const slot of slots) {
      expect(slot.openingEnd - slot.openingStart).toBeCloseTo(openingWidth, 5);
      expect(slot.paddleLength).toBeCloseTo(openingWidth * PONG_CONSTANTS.PADDLE_TO_GOAL_RATIO, 5);
      expect(slot.paddleMin).toBeCloseTo(slot.openingStart + slot.paddleLength / 2, 5);
      expect(slot.paddleMax).toBeCloseTo(slot.openingEnd - slot.paddleLength / 2, 5);
    }
  });

  it("builds every supported player count with the mandated edge pattern", () => {
    const cases: Record<number, (counts: Record<string, number>) => void> = {
      3: (counts) => {
        expect(Object.values(counts).filter((count) => count === 0)).toHaveLength(1);
        expect(Object.values(counts).filter((count) => count === 1)).toHaveLength(3);
      },
      4: (counts) => expect(Object.values(counts)).toEqual([1, 1, 1, 1]),
      5: (counts) => {
        expect(Object.values(counts).filter((count) => count === 2)).toHaveLength(1);
        expect(Object.values(counts).filter((count) => count === 1)).toHaveLength(3);
      },
      6: (counts) => {
        expect(Object.values(counts).filter((count) => count === 2)).toHaveLength(2);
        expect(Object.values(counts).filter((count) => count === 1)).toHaveLength(2);
        const doubled = Object.entries(counts)
          .filter(([, count]) => count === 2)
          .map(([edge]) => edge);
        const opposite: Record<string, string> = {
          top: "bottom",
          bottom: "top",
          left: "right",
          right: "left",
        };
        expect(opposite[doubled[0] ?? ""]).toBe(doubled[1]);
      },
      7: (counts) => {
        expect(Object.values(counts).filter((count) => count === 1)).toHaveLength(1);
        expect(Object.values(counts).filter((count) => count === 2)).toHaveLength(3);
      },
      8: (counts) => expect(Object.values(counts)).toEqual([2, 2, 2, 2]),
    };

    for (let count = 3; count <= 8; count++) {
      for (let seed = 0; seed < 8; seed++) {
        const slots = buildPongSlots(count, createMatchRng(`layout-${count}-${seed}`));
        expect(slots).toHaveLength(count);
        const counts: Record<string, number> = {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        };
        const openingWidth = PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.GOAL_RATIO_MULTI;
        for (const slot of slots) {
          counts[slot.worldEdge] = (counts[slot.worldEdge] ?? 0) + 1;
          expect(slot.openingEnd - slot.openingStart).toBeCloseTo(openingWidth, 5);
          expect(slot.paddleLength).toBeCloseTo(
            openingWidth * PONG_CONSTANTS.PADDLE_TO_GOAL_RATIO,
            5,
          );
        }
        cases[count]?.(counts);
      }
    }
  });

  it("never overlaps shared openings and keeps a solid divider between them", () => {
    for (let seed = 0; seed < 20; seed++) {
      const slots = buildPongSlots(8, createMatchRng(`shared-${seed}`));
      for (const edge of ["top", "right", "bottom", "left"] as const) {
        const onEdge = slots
          .filter((slot) => slot.worldEdge === edge)
          .sort((a, b) => a.openingStart - b.openingStart);
        expect(onEdge).toHaveLength(2);
        expect(onEdge[0]?.openingEnd).toBeLessThan(onEdge[1]?.openingStart ?? 0);
        const dividerWidth = PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.SHARED_EDGE_DIVIDER_RATIO;
        expect((onEdge[1]?.openingStart ?? 0) - (onEdge[0]?.openingEnd ?? 0)).toBeCloseTo(
          dividerWidth,
          5,
        );
      }
    }
  });

  it("shuffles player-to-slot assignments between matches", () => {
    const first = shuffledPongSlots(4, createMatchRng("shuffle-a"));
    const second = shuffledPongSlots(4, createMatchRng("shuffle-b"));
    const order = (slots: typeof first): string[] =>
      slots.map((slot) => `${slot.worldEdge}:${slot.slotIndex}`);
    expect(order(first)).not.toEqual(order(second));
  });
});

describe("pong clampDirection", () => {
  it("normalizes and keeps both axes meaningful", () => {
    const [x, y] = clampDirection(10, 0);
    expect(Math.hypot(x, y)).toBeCloseTo(1, 5);
    expect(Math.abs(x)).toBeGreaterThanOrEqual(PONG_CONSTANTS.MIN_DIRECTION_COMPONENT - 0.001);
    expect(Math.abs(y)).toBeGreaterThanOrEqual(PONG_CONSTANTS.MIN_DIRECTION_COMPONENT - 0.001);
  });

  it("preserves direction sign when clamping an axis", () => {
    const [x, y] = clampDirection(-1, 10);
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
  });
});

describe("pong match lifecycle", () => {
  it("starts a countdown with centred paddles, one warning ball, and stable colours", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime);
    expect(runtime.phase).toBe("countdown");
    expect(runtime.balls.size).toBe(1);
    expect(runtime.desiredBallCount).toBe(1);
    expect(runtime.ballSpeed).toBe(E2E.ballSpeed);
    const players = [...runtime.players.values()];
    expect(players[0]?.color).not.toBe(players[1]?.color);
    for (const player of players) {
      expect(player.score).toBe(0);
      expect(player.paddleCenter).toBe((player.paddleMin + player.paddleMax) / 2);
    }
    const ball = [...runtime.balls.values()][0];
    expect(ball?.state).toBe("warning");
  });

  it("moves paddles during the countdown without moving the ball or scoring", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime);
    const player = [...runtime.players.values()][0];
    if (!player) {
      throw new Error("missing player");
    }
    player.queuedTarget = 1;
    const ballId = [...runtime.balls.keys()][0] ?? "";
    const before = runtime.balls.get(ballId);
    advance(runtime, 1_000, 1_490);
    expect(player.paddleCenter).toBeGreaterThan((player.paddleMin + player.paddleMax) / 2);
    expect(runtime.balls.get(ballId)?.x).toBe(before?.x);
    expect(runtime.balls.get(ballId)?.y).toBe(before?.y);
    expect(runtime.phase).toBe("countdown");
    expect([...runtime.players.values()].every((candidate) => candidate.score === 0)).toBe(true);
  });

  it("launches the first ball on GO and begins the match timer", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    expect(runtime.phase).toBe("running");
    const ball = [...runtime.balls.values()][0];
    expect(ball?.state).toBe("moving");
    expect(Math.hypot(ball?.vx ?? 0, ball?.vy ?? 0)).toBeCloseTo(E2E.ballSpeed, 3);
    expect(runtime.matchElapsedMs).toBe(0);
  });

  it("resets scores, balls, and elapsed time for a rematch", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime);
    const scorer = [...runtime.players.values()][0];
    if (scorer) {
      scorer.score = 10;
    }
    resetForNewMatch(runtime);
    expect(runtime.phase).toBe("lobby");
    expect(runtime.balls.size).toBe(0);
    expect(runtime.result).toBeNull();
    expect([...runtime.players.values()].every((player) => player.score === 0)).toBe(true);
    expect(startMatch(runtime, 2_000)).toBe(true);
    expect(runtime.balls.size).toBe(1);
  });
});

describe("pong ball progression", () => {
  it("adds balls on the fixed interval until the player-count cap", () => {
    const runtime = runtimeWithPlayers(4);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    expect(runtime.balls.size).toBe(1);
    advance(runtime, 1_000 + E2E.countdownMs, 1_000 + E2E.countdownMs + 600);
    expect(runtime.balls.size).toBe(2);
    advance(runtime, 1_000 + E2E.countdownMs + 600, 1_000 + E2E.countdownMs + 1_200);
    expect(runtime.balls.size).toBe(3);
    advance(runtime, 1_000 + E2E.countdownMs + 1_200, 1_000 + E2E.countdownMs + 2_400);
    expect(runtime.balls.size).toBe(3);
  });

  it("caps a two-player match at two balls", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    advance(runtime, 1_000 + E2E.countdownMs, 1_000 + E2E.countdownMs + 8_000);
    expect(runtime.balls.size).toBe(2);
  });

  it("spawns a warning replacement after a scored ball without removing others", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    runSteps(runtime, 1);
    const originalId = [...runtime.balls.keys()][0] ?? "";
    const defender = [...runtime.players.values()].find((player) => player.worldEdge === "bottom");
    const owner = [...runtime.players.values()].find((player) => player !== defender);
    if (!owner || !defender) {
      throw new Error("expected distinct owner and bottom defender");
    }
    const ball = runtime.balls.get(originalId);
    if (!ball) {
      throw new Error("missing ball");
    }
    ball.ownerSessionId = owner.sessionId;
    movingBallAt(
      runtime,
      originalId,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      PONG_CONSTANTS.WORLD_SIZE - 4,
      0,
      E2E.ballSpeed,
    );
    runSteps(runtime, 1);
    expect(runtime.balls.has(originalId)).toBe(false);
    expect(owner.score).toBe(1);
    expect(runtime.balls.size).toBe(1);
    const replacement = [...runtime.balls.values()][0];
    expect(replacement?.state).toBe("warning");
    expect(replacement?.ownerSessionId).toBe("");
  });
});

describe("pong scoring", () => {
  it("awards a point only to the last owner when another player misses", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const defender = playersOn(runtime, "bottom")[0];
    const owner = [...runtime.players.values()].find((player) => player !== defender);
    if (!owner || !defender) {
      throw new Error("missing players");
    }
    const ballId = [...runtime.balls.keys()][0] ?? "";
    const ball = runtime.balls.get(ballId);
    if (!ball) {
      throw new Error("missing ball");
    }
    ball.ownerSessionId = owner.sessionId;
    movingBallAt(
      runtime,
      ballId,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      PONG_CONSTANTS.WORLD_SIZE - 4,
      0,
      E2E.ballSpeed,
    );
    runSteps(runtime, 1);
    expect(owner.score).toBe(1);
    expect(defender.score).toBe(0);
    expect(runtime.players.size).toBe(2);
  });

  it("awards nothing for neutral exits and own-goals", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const defender = playersOn(runtime, "bottom")[0];
    if (!defender) {
      throw new Error("missing defender");
    }
    const ballId = [...runtime.balls.keys()][0] ?? "";
    movingBallAt(
      runtime,
      ballId,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      PONG_CONSTANTS.WORLD_SIZE - 4,
      0,
      E2E.ballSpeed,
    );
    runSteps(runtime, 1);
    expect(defender.score).toBe(0);
    expect(runtime.lastGoalScorerSessionId).toBe("");
    expect(runtime.lastGoalDefenderSessionId).toBe(defender.sessionId);

    const nextBallId = [...runtime.balls.keys()][0] ?? "";
    movingBallAt(
      runtime,
      nextBallId,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      PONG_CONSTANTS.WORLD_SIZE - 4,
      0,
      E2E.ballSpeed,
    );
    const ball = runtime.balls.get(nextBallId);
    if (ball) {
      ball.ownerSessionId = defender.sessionId;
    }
    runSteps(runtime, 1);
    expect(defender.score).toBe(0);
    expect(runtime.lastGoalScorerSessionId).toBe("");
    expect(runtime.lastGoalDefenderSessionId).toBe(defender.sessionId);
  });

  it("preserves ownership through wall and corner bounces", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const owner = [...runtime.players.values()][0];
    if (!owner) {
      throw new Error("missing owner");
    }
    const ballId = [...runtime.balls.keys()][0] ?? "";
    movingBallAt(
      runtime,
      ballId,
      10,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      -E2E.ballSpeed * 0.7,
      E2E.ballSpeed * 0.7,
    );
    const ball = runtime.balls.get(ballId);
    if (ball) {
      ball.ownerSessionId = owner.sessionId;
    }
    runSteps(runtime, 3);
    expect(runtime.balls.has(ballId)).toBe(true);
    expect(runtime.balls.get(ballId)?.ownerSessionId).toBe(owner.sessionId);
    expect(runtime.balls.get(ballId)?.x).toBeGreaterThan(0);
    expect(
      Math.hypot(runtime.balls.get(ballId)?.vx ?? 0, runtime.balls.get(ballId)?.vy ?? 0),
    ).toBeCloseTo(E2E.ballSpeed, 3);
  });

  it("transfers ownership on a paddle hit and returns at an angle", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const player = playersOn(runtime, "bottom")[0];
    if (!player) {
      throw new Error("missing bottom player");
    }
    player.paddleCenter = player.paddleMin + (player.paddleMax - player.paddleMin) * 0.5;
    const ballId = [...runtime.balls.keys()][0] ?? "";
    movingBallAt(
      runtime,
      ballId,
      player.paddleCenter,
      PONG_CONSTANTS.WORLD_SIZE - 80,
      0,
      E2E.ballSpeed,
    );
    runSteps(runtime, 5);
    const ball = runtime.balls.get(ballId);
    expect(ball?.ownerSessionId).toBe(player.sessionId);
    expect(Math.hypot(ball?.vx ?? 0, ball?.vy ?? 0)).toBeCloseTo(E2E.ballSpeed, 3);
    expect(Math.abs(ball?.vx ?? 0)).toBeGreaterThan(
      PONG_CONSTANTS.MIN_DIRECTION_COMPONENT * E2E.ballSpeed * 0.9,
    );
    expect(Math.abs(ball?.vy ?? 0)).toBeGreaterThan(
      PONG_CONSTANTS.MIN_DIRECTION_COMPONENT * E2E.ballSpeed * 0.9,
    );
  });

  it("bounces from a shared-edge divider without scoring or changing ownership", () => {
    const runtime = runtimeWithPlayers(5);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const shared = ["top", "right", "bottom", "left"]
      .map((edge) => playersOn(runtime, edge as "top" | "right" | "bottom" | "left"))
      .find((players) => players.length === 2);
    if (!shared) {
      throw new Error("expected a shared edge");
    }
    const first = shared[0];
    const second = shared[1];
    if (!first || !second) {
      throw new Error("missing shared players");
    }
    const dividerCenter = (first.openingEnd + second.openingStart) / 2;
    const owner = [...runtime.players.values()][0];
    if (!owner) {
      throw new Error("missing owner");
    }
    const ballId = [...runtime.balls.keys()][0] ?? "";
    const edge = first.worldEdge;
    const coord = edge === "top" || edge === "bottom" ? "x" : "y";
    const boundary = edge === "top" || edge === "bottom" ? "y" : "x";
    const position: Record<string, number> = {
      x: PONG_CONSTANTS.WORLD_SIZE / 2,
      y: PONG_CONSTANTS.WORLD_SIZE / 2,
    };
    position[coord] = dividerCenter;
    const velocity: Record<string, number> = { x: 0, y: 0 };
    velocity[boundary] = edge === "top" || edge === "left" ? -E2E.ballSpeed : E2E.ballSpeed;
    movingBallAt(
      runtime,
      ballId,
      position.x ?? 0,
      position.y ?? 0,
      velocity.x ?? 0,
      velocity.y ?? 0,
    );
    const ball = runtime.balls.get(ballId);
    if (ball) {
      ball.ownerSessionId = owner.sessionId;
    }
    runSteps(runtime, 18);
    expect(runtime.balls.has(ballId)).toBe(true);
    expect(runtime.balls.get(ballId)?.ownerSessionId).toBe(owner.sessionId);
    expect([...runtime.players.values()].every((player) => player.score === 0)).toBe(true);
    const after = runtime.balls.get(ballId);
    if (!after) {
      throw new Error("missing ball after bounce");
    }
    expect(after.x).toBeGreaterThan(0);
    expect(after.x).toBeLessThan(PONG_CONSTANTS.WORLD_SIZE);
    expect(after.y).toBeGreaterThan(0);
    expect(after.y).toBeLessThan(PONG_CONSTANTS.WORLD_SIZE);
  });

  it("lets balls pass through each other unchanged", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const firstId = [...runtime.balls.keys()][0] ?? "";
    addSecondBall(runtime, firstId);
    const secondId = "ball-2";
    movingBallAt(runtime, firstId, 300, 300, E2E.ballSpeed * 0.6, E2E.ballSpeed * 0.8);
    movingBallAt(runtime, secondId, 300, 300, -E2E.ballSpeed * 0.6, -E2E.ballSpeed * 0.8);
    runSteps(runtime, 3);
    const first = runtime.balls.get(firstId);
    const second = runtime.balls.get(secondId);
    expect(first?.x).toBeGreaterThan(300);
    expect(second?.x).toBeLessThan(300);
    expect(first?.ownerSessionId).toBe("");
    expect(second?.ownerSessionId).toBe("");
    expect(Math.hypot(first?.vx ?? 0, first?.vy ?? 0)).toBeCloseTo(E2E.ballSpeed, 3);
    expect(Math.hypot(second?.vx ?? 0, second?.vy ?? 0)).toBeCloseTo(E2E.ballSpeed, 3);
  });

  it("processes every score event from one step and declares co-winners", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const bottom = playersOn(runtime, "bottom")[0];
    const top = playersOn(runtime, "top")[0];
    if (!bottom || !top) {
      throw new Error("missing players");
    }
    bottom.score = 9;
    top.score = 9;
    addSecondBall(runtime, [...runtime.balls.keys()][0] ?? "");
    const [firstId, secondId] = [...runtime.balls.keys()];
    if (!firstId || !secondId) {
      throw new Error("missing balls");
    }
    // Top-owned ball crosses the bottom goal; bottom-owned ball crosses the top goal.
    movingBallAt(
      runtime,
      firstId,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      PONG_CONSTANTS.WORLD_SIZE - 4,
      0,
      E2E.ballSpeed,
    );
    const firstBall = runtime.balls.get(firstId);
    if (!firstBall) {
      throw new Error("missing first ball");
    }
    firstBall.ownerSessionId = top.sessionId;
    movingBallAt(runtime, secondId, PONG_CONSTANTS.WORLD_SIZE / 2, 4, 0, -E2E.ballSpeed);
    const secondBall = runtime.balls.get(secondId);
    if (!secondBall) {
      throw new Error("missing second ball");
    }
    secondBall.ownerSessionId = bottom.sessionId;
    runSteps(runtime, 1);
    expect(bottom.score).toBe(10);
    expect(top.score).toBe(10);
    expect(runtime.phase).toBe("finished");
    expect(runtime.result?.winnerSessionIds.sort()).toEqual(
      [bottom.sessionId, top.sessionId].sort(),
    );
    expect(runtime.balls.size).toBe(2);
    for (const ball of runtime.balls.values()) {
      expect(ball.state).toBe("warning");
    }
  });

  it("lets a winner finish above 10 and freezes scores afterwards", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const bottom = playersOn(runtime, "bottom")[0];
    const top = playersOn(runtime, "top")[0];
    if (!bottom || !top) {
      throw new Error("missing players");
    }
    bottom.score = 9;
    addSecondBall(runtime, [...runtime.balls.keys()][0] ?? "");
    const [firstId, secondId] = [...runtime.balls.keys()];
    if (!firstId || !secondId) {
      throw new Error("missing balls");
    }
    movingBallAt(runtime, firstId, PONG_CONSTANTS.WORLD_SIZE / 2, 4, 0, -E2E.ballSpeed);
    const firstBall = runtime.balls.get(firstId);
    if (!firstBall) {
      throw new Error("missing first ball");
    }
    firstBall.ownerSessionId = bottom.sessionId;
    movingBallAt(runtime, secondId, PONG_CONSTANTS.WORLD_SIZE / 2 + 40, 4, 0, -E2E.ballSpeed);
    const secondBall = runtime.balls.get(secondId);
    if (!secondBall) {
      throw new Error("missing second ball");
    }
    secondBall.ownerSessionId = bottom.sessionId;
    runSteps(runtime, 1);
    expect(bottom.score).toBe(11);
    expect(runtime.phase).toBe("finished");
    expect(runtime.result?.winnerSessionIds).toEqual([bottom.sessionId]);

    const ball = [...runtime.balls.values()][0];
    const xBefore = ball?.x;
    const yBefore = ball?.y;
    advance(runtime, 2_100, 2_500);
    expect(runtime.balls.get(ball?.id ?? "")?.x).toBe(xBefore);
    expect(runtime.balls.get(ball?.id ?? "")?.y).toBe(yBefore);
    expect(bottom.score).toBe(11);
  });
});

describe("pong production settings", () => {
  it("uses production pacing, central random spawns, and clamped directions", () => {
    const runtime = createRuntime(buildSettings({ e2eMode: false }));
    addPlayer(runtime, "session-0", "Player 0", 0);
    addPlayer(runtime, "session-1", "Player 1", 1);
    start(runtime, 1_000);

    expect(runtime.ballSpeed).toBe(PONG_CONSTANTS.BALL_SPEED);
    expect(runtime.settings.escalationIntervalMs).toBe(PONG_CONSTANTS.ESCALATION_INTERVAL_MS);
    expect(runtime.settings.spawnWarningMs).toBe(PONG_CONSTANTS.SPAWN_WARNING_MS);
    const ball = [...runtime.balls.values()][0];
    if (!ball) {
      throw new Error("missing ball");
    }
    expect(Math.abs(ball.x - PONG_CONSTANTS.WORLD_SIZE / 2)).toBeLessThanOrEqual(80);
    expect(Math.abs(ball.y - PONG_CONSTANTS.WORLD_SIZE / 2)).toBeLessThanOrEqual(80);
    const [vx, vy] = clampDirection(ball.vx, ball.vy);
    expect(Math.abs(vx)).toBeGreaterThanOrEqual(PONG_CONSTANTS.MIN_DIRECTION_COMPONENT - 0.001);
    expect(Math.abs(vy)).toBeGreaterThanOrEqual(PONG_CONSTANTS.MIN_DIRECTION_COMPONENT - 0.001);

    const player = [...runtime.players.values()][0];
    if (!player) {
      throw new Error("missing player");
    }
    const expectedPaddleSpeed =
      (player.paddleMax - player.paddleMin) / PONG_CONSTANTS.PADDLE_CROSS_TIME_SECONDS;
    expect(runtime.paddleSpeed).toBeCloseTo(expectedPaddleSpeed, 5);
  });
});

describe("pong ball caps and continuity", () => {
  it("caps every supported player count at the mandated ball maximum", () => {
    const expectedByCount = PONG_CONSTANTS.MAX_BALLS_BY_PLAYERS;
    for (let count = 2; count <= 8; count++) {
      const runtime = runtimeWithPlayers(count);
      start(runtime, 1_000);
      updatePong(runtime, 1_000 + E2E.countdownMs);
      advance(runtime, 1_000 + E2E.countdownMs, 60_000);
      const expected = expectedByCount[count as 2 | 3 | 4 | 5 | 6 | 7 | 8];
      expect(runtime.maxBallCount, `player count ${count}`).toBe(expected);
      expect(runtime.desiredBallCount, `player count ${count}`).toBe(expected);
      expect(runtime.balls.size, `player count ${count}`).toBeLessThanOrEqual(expected);
    }
  }, 30_000);

  it("keeps the starting ball cap after players leave mid-match", () => {
    const runtime = runtimeWithPlayers(8);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    advance(runtime, 1_000 + E2E.countdownMs, 4_000);
    expect(runtime.maxBallCount).toBe(5);
    expect(runtime.desiredBallCount).toBe(5);
    expect(runtime.balls.size).toBe(5);

    const [firstSession, secondSession] = [...runtime.players.keys()];
    if (!firstSession || !secondSession) {
      throw new Error("missing sessions");
    }
    removePlayer(runtime, firstSession);
    removePlayer(runtime, secondSession);
    advance(runtime, 4_000, 5_000);
    expect(runtime.maxBallCount).toBe(5);
    expect(runtime.desiredBallCount).toBe(5);
    expect(runtime.balls.size).toBeLessThanOrEqual(5);
  });

  it("keeps other balls moving when one ball scores in the same step", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const firstId = [...runtime.balls.keys()][0] ?? "";
    addSecondBall(runtime, firstId);
    const secondId = "ball-2";
    const top = playersOn(runtime, "top")[0];
    const bottom = playersOn(runtime, "bottom")[0];
    if (!top || !bottom) {
      throw new Error("missing players");
    }
    movingBallAt(
      runtime,
      firstId,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      PONG_CONSTANTS.WORLD_SIZE - 4,
      0,
      E2E.ballSpeed,
    );
    const firstBall = runtime.balls.get(firstId);
    if (!firstBall) {
      throw new Error("missing first ball");
    }
    firstBall.ownerSessionId = top.sessionId;
    movingBallAt(
      runtime,
      secondId,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      0,
      -E2E.ballSpeed,
    );

    runSteps(runtime, 1);
    expect(top.score).toBe(1);
    expect(bottom.score).toBe(0);
    const second = runtime.balls.get(secondId);
    if (!second) {
      throw new Error("second ball was removed");
    }
    expect(second.y).toBeLessThan(PONG_CONSTANTS.WORLD_SIZE / 2);
    expect(second.ownerSessionId).toBe("");
  });

  it("does not rescue a ball whose centre has already crossed the goal line", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const top = playersOn(runtime, "top")[0];
    const bottom = playersOn(runtime, "bottom")[0];
    if (!top || !bottom) {
      throw new Error("missing players");
    }
    const ballId = [...runtime.balls.keys()][0] ?? "";
    movingBallAt(
      runtime,
      ballId,
      PONG_CONSTANTS.WORLD_SIZE / 2,
      PONG_CONSTANTS.WORLD_SIZE + 5,
      0,
      E2E.ballSpeed,
    );
    const ball = runtime.balls.get(ballId);
    if (!ball) {
      throw new Error("missing ball");
    }
    ball.ownerSessionId = top.sessionId;
    runSteps(runtime, 1);
    expect(runtime.balls.has(ballId)).toBe(false);
    expect(top.score).toBe(1);
    expect(bottom.score).toBe(0);
  });
});

describe("pong paddle territories", () => {
  it("clamps shared-edge paddles inside their own territories without overlap", () => {
    const runtime = runtimeWithPlayers(5);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    for (const player of runtime.players.values()) {
      player.queuedTarget = player.slotIndex === 0 ? 1 : 0;
    }
    runSteps(runtime, 100);

    for (const edge of ["top", "right", "bottom", "left"] as const) {
      const shared = playersOn(runtime, edge).sort((a, b) => a.openingStart - b.openingStart);
      if (shared.length < 2) {
        continue;
      }
      const first = shared[0];
      const second = shared[1];
      if (!first || !second) {
        throw new Error("missing shared players");
      }
      for (const player of shared) {
        expect(player.paddleCenter).toBeGreaterThanOrEqual(player.paddleMin - 0.01);
        expect(player.paddleCenter).toBeLessThanOrEqual(player.paddleMax + 0.01);
      }
      const firstRect = paddleRect({
        worldEdge: edge,
        paddleCenter: first.paddleCenter,
        paddleLength: first.paddleLength,
      });
      const secondRect = paddleRect({
        worldEdge: edge,
        paddleCenter: second.paddleCenter,
        paddleLength: second.paddleLength,
      });
      if (edge === "top" || edge === "bottom") {
        expect(firstRect.x + firstRect.width).toBeLessThanOrEqual(secondRect.x + 0.01);
      } else {
        expect(firstRect.y + firstRect.height).toBeLessThanOrEqual(secondRect.y + 0.01);
      }
    }
  });
});

describe("pong collision speed", () => {
  it("preserves ball speed through a corner bumper without changing ownership", () => {
    const runtime = runtimeWithPlayers(2);
    start(runtime, 1_000);
    updatePong(runtime, 1_000 + E2E.countdownMs);
    const owner = [...runtime.players.values()][0];
    if (!owner) {
      throw new Error("missing owner");
    }
    const ballId = [...runtime.balls.keys()][0] ?? "";
    movingBallAt(runtime, ballId, 25, 25, -E2E.ballSpeed * 0.7, -E2E.ballSpeed * 0.7);
    const ball = runtime.balls.get(ballId);
    if (!ball) {
      throw new Error("missing ball");
    }
    ball.ownerSessionId = owner.sessionId;
    runSteps(runtime, 3);
    const after = runtime.balls.get(ballId);
    if (!after) {
      throw new Error("ball removed by bumper");
    }
    expect(after.x).toBeGreaterThan(0);
    expect(after.y).toBeGreaterThan(0);
    expect(after.ownerSessionId).toBe(owner.sessionId);
    expect(Math.hypot(after.vx, after.vy)).toBeCloseTo(E2E.ballSpeed, 3);
  });
});

function addSecondBall(runtime: PongRuntime, firstId: string): void {
  const first = runtime.balls.get(firstId);
  if (!first) {
    throw new Error("missing first ball");
  }
  runtime.balls.set("ball-2", {
    id: "ball-2",
    x: PONG_CONSTANTS.WORLD_SIZE / 2,
    y: PONG_CONSTANTS.WORLD_SIZE / 2,
    vx: 0,
    vy: 0,
    ownerSessionId: "",
    state: "moving",
    spawnsAt: 0,
  });
  runtime.nextBallId = 3;
}
