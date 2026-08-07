import { PONG_CONSTANTS, type PongWorldEdge } from "@phone-party/protocol";

import type { PongSlot } from "./types.js";

const EDGES = ["top", "right", "bottom", "left"] as const satisfies readonly PongWorldEdge[];

type EdgeCounts = Record<PongWorldEdge, number>;

/**
 * Authoritative player-layout builder. Every player in a 3-8 player match
 * receives the same personal opening width (44% of an edge); shared edges are
 * split as 4% outer wall, 44% opening, 4% divider, 44% opening, 4% outer
 * wall. Two-player mode uses larger symmetric 80% openings on top and bottom.
 * The asymmetric layouts rotate randomly through the legal configurations.
 */
export function buildPongSlots(playerCount: number, rng: () => number): PongSlot[] {
  if (playerCount < PONG_CONSTANTS.MIN_PLAYERS || playerCount > PONG_CONSTANTS.MAX_PLAYERS) {
    throw new Error(
      `Pong supports ${PONG_CONSTANTS.MIN_PLAYERS}-${PONG_CONSTANTS.MAX_PLAYERS} players`,
    );
  }
  const counts = edgeCountsFor(playerCount, rng);
  const openingWidth =
    playerCount === 2
      ? PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.TWO_PLAYER_GOAL_RATIO
      : PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.GOAL_RATIO_MULTI;
  const paddleLength = openingWidth * PONG_CONSTANTS.PADDLE_TO_GOAL_RATIO;
  const slots: PongSlot[] = [];

  for (const edge of EDGES) {
    const count = counts[edge];
    if (count === 1) {
      const start =
        playerCount === 2
          ? PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.TWO_PLAYER_SIDE_RATIO
          : (PONG_CONSTANTS.WORLD_SIZE - openingWidth) / 2;
      const end = start + openingWidth;
      slots.push(singleSlot(edge, start, end, paddleLength));
    } else if (count === 2) {
      const outer = PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.SHARED_EDGE_OUTER_RATIO;
      const divider = PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.SHARED_EDGE_DIVIDER_RATIO;
      const firstEnd = outer + openingWidth;
      const secondStart = firstEnd + divider;
      slots.push(singleSlot(edge, outer, firstEnd, paddleLength, 0));
      slots.push(singleSlot(edge, secondStart, PONG_CONSTANTS.WORLD_SIZE - outer, paddleLength, 1));
    }
  }
  return slots;
}

/** Shuffles slots with the match RNG so player-to-slot assignments rotate. */
export function shuffledPongSlots(playerCount: number, rng: () => number): PongSlot[] {
  const slots = buildPongSlots(playerCount, rng);
  for (let index = slots.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = slots[index] as PongSlot;
    const swap = slots[swapIndex] as PongSlot;
    slots[index] = swap;
    slots[swapIndex] = current;
  }
  return slots;
}

function singleSlot(
  worldEdge: PongWorldEdge,
  openingStart: number,
  openingEnd: number,
  paddleLength: number,
  slotIndex = 0,
): PongSlot {
  return {
    worldEdge,
    slotIndex,
    openingStart,
    openingEnd,
    paddleLength,
    paddleMin: openingStart + paddleLength / 2,
    paddleMax: openingEnd - paddleLength / 2,
  };
}

function edgeCountsFor(playerCount: number, rng: () => number): EdgeCounts {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  if (playerCount === 2) {
    return { top: 1, right: 0, bottom: 1, left: 0 };
  }
  if (playerCount === 4) {
    return { top: 1, right: 1, bottom: 1, left: 1 };
  }
  if (playerCount === 8) {
    return { top: 2, right: 2, bottom: 2, left: 2 };
  }
  const randomEdge = EDGES[Math.floor(rng() * EDGES.length)];
  if (randomEdge === undefined) {
    throw new Error("Unexpected random edge");
  }
  if (playerCount === 3) {
    return { ...zero, [randomEdge]: 0, ...allExcept(randomEdge, 1) };
  }
  if (playerCount === 5) {
    return { ...zero, [randomEdge]: 2, ...allExcept(randomEdge, 1) };
  }
  if (playerCount === 7) {
    return { ...zero, [randomEdge]: 1, ...allExcept(randomEdge, 2) };
  }
  if (playerCount === 6) {
    const pair: readonly PongWorldEdge[] = rng() < 0.5 ? ["top", "bottom"] : ["left", "right"];
    return {
      top: pair.includes("top") ? 2 : 1,
      right: pair.includes("right") ? 2 : 1,
      bottom: pair.includes("bottom") ? 2 : 1,
      left: pair.includes("left") ? 2 : 1,
    };
  }
  throw new Error(`Unsupported Pong player count: ${playerCount}`);
}

function allExcept(edge: PongWorldEdge, count: number): Partial<EdgeCounts> {
  const result: Partial<EdgeCounts> = {};
  for (const candidate of EDGES) {
    if (candidate !== edge) {
      result[candidate] = count;
    }
  }
  return result;
}
