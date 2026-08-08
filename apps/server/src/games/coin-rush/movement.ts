import { COIN_RUSH_CONSTANTS, type CoinRushDirection, coinRushCellId } from "@phone-party/protocol";

import type { CoinRushRuntime, RuntimePlayer } from "./types.js";

export interface GridPos {
  x: number;
  y: number;
}

interface MoveEntry {
  sessionId: string;
  direction: CoinRushDirection;
  from: GridPos;
  to: GridPos;
  falls: boolean;
  pushed: boolean;
}

type Plan = { kind: "success"; moves: MoveEntry[] } | { kind: "bounce" };

interface ResolutionContext {
  runtime: CoinRushRuntime;
  intents: ReadonlyMap<string, CoinRushDirection>;
  conflicts: Set<string>;
  memo: Map<string, Plan>;
  planning: Set<string>;
}

export const DIRECTION_DELTAS: Record<CoinRushDirection, GridPos> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function targetPosition(
  player: Pick<RuntimePlayer, "x" | "y">,
  direction: CoinRushDirection,
): GridPos {
  const delta = DIRECTION_DELTAS[direction];
  return { x: player.x + delta.x, y: player.y + delta.y };
}

export function isInsideBoard(pos: GridPos, colCount: number, rowCount: number): boolean {
  return pos.x >= 0 && pos.x < colCount && pos.y >= 0 && pos.y < rowCount;
}

function success(moves: MoveEntry[]): Plan {
  return { kind: "success", moves };
}

function bouncePlan(): Plan {
  return { kind: "bounce" };
}

function makeMove(
  player: RuntimePlayer,
  direction: CoinRushDirection,
  to: GridPos,
  falls: boolean,
  pushed: boolean,
): MoveEntry {
  return {
    sessionId: player.sessionId,
    direction,
    from: { x: player.x, y: player.y },
    to,
    falls,
    pushed,
  };
}

function playerAt(runtime: CoinRushRuntime, pos: GridPos): RuntimePlayer | undefined {
  for (const player of runtime.players.values()) {
    if (runtime.suddenDeath && !player.suddenDeathEligible) {
      continue;
    }
    if (player.alive && player.x === pos.x && player.y === pos.y) {
      return player;
    }
  }
  return undefined;
}

function planForIntent(sessionId: string, context: ResolutionContext): Plan {
  const cached = context.memo.get(sessionId);
  if (cached !== undefined) {
    return cached;
  }
  if (context.planning.has(sessionId)) {
    return bouncePlan();
  }
  const player = context.runtime.players.get(sessionId);
  const direction = context.intents.get(sessionId);
  if (!player || direction === undefined) {
    return bouncePlan();
  }
  context.planning.add(sessionId);
  const plan = tryMove(player, direction, new Set(), false, context);
  context.planning.delete(sessionId);
  context.memo.set(sessionId, plan);
  return plan;
}

/**
 * Recursively plans one player's movement in `direction`.
 *
 * When the target is empty, the move succeeds. When the target is occupied by
 * a player whose own simultaneous move succeeds away from this player, the
 * occupant moves by its own intent and this player fills its old cell without
 * pushing. Otherwise the occupant is pushed, and the push propagates through
 * contiguous players. A pushed player forced beyond the board falls; a
 * voluntary swipe beyond the board bounces instead.
 */
function tryMove(
  player: RuntimePlayer,
  direction: CoinRushDirection,
  chain: Set<string>,
  isPush: boolean,
  context: ResolutionContext,
): Plan {
  if (chain.has(player.sessionId)) {
    return bouncePlan();
  }

  const target = targetPosition(player, direction);
  if (!isInsideBoard(target, COIN_RUSH_CONSTANTS.COL_COUNT, COIN_RUSH_CONSTANTS.ROW_COUNT)) {
    if (isPush) {
      return success([makeMove(player, direction, target, true, true)]);
    }
    return bouncePlan();
  }

  const occupant = playerAt(context.runtime, target);
  if (!occupant) {
    return success([makeMove(player, direction, target, false, isPush)]);
  }

  const occupantDirection = context.intents.get(occupant.sessionId);
  if (
    occupantDirection !== undefined &&
    !context.conflicts.has(occupant.sessionId) &&
    !context.planning.has(occupant.sessionId)
  ) {
    const occupantPlan = planForIntent(occupant.sessionId, context);
    const occupantMove = occupantPlan.kind === "success" ? occupantPlan.moves[0] : undefined;
    if (
      occupantPlan.kind === "success" &&
      occupantMove !== undefined &&
      !(occupantMove.to.x === player.x && occupantMove.to.y === player.y)
    ) {
      return success([makeMove(player, direction, target, false, isPush), ...occupantPlan.moves]);
    }
  }

  const nextChain = new Set(chain);
  nextChain.add(player.sessionId);
  if (nextChain.has(occupant.sessionId)) {
    return bouncePlan();
  }
  const pushPlan = tryMove(occupant, direction, nextChain, true, context);
  if (pushPlan.kind === "bounce") {
    return bouncePlan();
  }
  return success([makeMove(player, direction, target, false, isPush), ...pushPlan.moves]);
}

function detectConflicts(plans: ReadonlyMap<string, Plan>): Set<string> {
  const cellClaims = new Map<string, Array<{ intent: string; entry: MoveEntry }>>();
  const playerClaims = new Map<string, Array<{ intent: string; entry: MoveEntry }>>();

  for (const [intentSessionId, plan] of plans) {
    if (plan.kind !== "success") {
      continue;
    }
    for (const entry of plan.moves) {
      const cellKey = coinRushCellId(entry.to.x, entry.to.y);
      const cellList = cellClaims.get(cellKey) ?? [];
      cellList.push({ intent: intentSessionId, entry });
      cellClaims.set(cellKey, cellList);

      const playerList = playerClaims.get(entry.sessionId) ?? [];
      playerList.push({ intent: intentSessionId, entry });
      playerClaims.set(entry.sessionId, playerList);
    }
  }

  const conflicts = new Set<string>();
  for (const claims of cellClaims.values()) {
    const intents = new Set(claims.map((claim) => claim.intent));
    if (intents.size <= 1) {
      continue;
    }
    const players = new Set(claims.map((claim) => claim.entry.sessionId));
    // Two different plans moving different players onto the same cell, or
    // moving the same player to a different cell, are real conflicts.
    const samePlayerDifferently = [...playerClaims.values()].some(
      (playerList) =>
        playerList.length > 1 &&
        new Set(playerList.map((claim) => claim.entry.sessionId)).size === 1 &&
        new Set(playerList.map((claim) => claim.intent)).size > 1 &&
        new Set(
          playerList.map(
            (claim) =>
              `${claim.entry.from.x}:${claim.entry.from.y}:${claim.entry.to.x}:${claim.entry.to.y}`,
          ),
        ).size > 1,
    );
    if (players.size > 1 || samePlayerDifferently) {
      for (const intent of intents) {
        conflicts.add(intent);
      }
    }
  }

  for (const claims of playerClaims.values()) {
    const intents = new Set(claims.map((claim) => claim.intent));
    if (intents.size <= 1) {
      continue;
    }
    const destinations = new Set(
      claims.map(
        (claim) =>
          `${claim.entry.from.x}:${claim.entry.from.y}:${claim.entry.to.x}:${claim.entry.to.y}`,
      ),
    );
    if (destinations.size > 1) {
      for (const intent of intents) {
        conflicts.add(intent);
      }
    }
  }

  return conflicts;
}

function applyMove(runtime: CoinRushRuntime, entry: MoveEntry, now: number): void {
  const player = runtime.players.get(entry.sessionId);
  if (!player) {
    return;
  }
  player.fromX = entry.from.x;
  player.fromY = entry.from.y;
  player.toX = entry.to.x;
  player.toY = entry.to.y;
  player.moving = true;
  player.push = entry.pushed;
  player.bouncing = false;
  player.moveStartedAt = now;
  player.moveEndsAt =
    now + (entry.pushed ? runtime.settings.pushDurationMs : runtime.settings.moveDurationMs);
  if (entry.falls) {
    killPlayer(runtime, player, "fall", now);
  }
}

function applyBounce(
  runtime: CoinRushRuntime,
  player: RuntimePlayer,
  direction: CoinRushDirection,
  now: number,
): void {
  const target = targetPosition(player, direction);
  player.fromX = player.x;
  player.fromY = player.y;
  player.toX = target.x;
  player.toY = target.y;
  player.bouncing = true;
  player.moving = false;
  player.push = false;
  player.bounceStartedAt = now;
  player.bounceEndsAt = now + runtime.settings.bounceDurationMs;
}

function killPlayer(
  runtime: CoinRushRuntime,
  player: RuntimePlayer,
  type: "vehicle" | "fall",
  now: number,
): void {
  if (!player.alive) {
    return;
  }
  player.alive = false;
  player.deathType = type;
  player.diedAt = now;
  player.deaths += 1;
  player.roundDeaths += 1;
  player.respawning = true;
  player.respawnEndsAt =
    now + runtime.settings.deathAnimationMs + runtime.settings.respawnCooldownMs;
  runtime.pendingMoves.delete(player.sessionId);
}

/**
 * Resolves all pending swipes as one simultaneous movement-resolution window.
 *
 * The room batches intents for the current tick, so near-simultaneous messages
 * are grouped. Message arrival order never decides conflicts: same-destination
 * moves, swaps, and overlapping push chains are cancelled together, while
 * independent movement elsewhere proceeds normally.
 */
export function resolveMovement(runtime: CoinRushRuntime, now: number): void {
  if (runtime.pendingMoves.size === 0) {
    return;
  }

  const intents = new Map<string, CoinRushDirection>();
  for (const [sessionId, pending] of runtime.pendingMoves) {
    const player = runtime.players.get(sessionId);
    if (runtime.suddenDeath && player !== undefined && !player.suddenDeathEligible) {
      continue;
    }
    intents.set(sessionId, pending.direction);
  }

  // Direct conflicts: two intents targeting the same cell, and swaps where
  // each player targets the other's current cell.
  const conflicts = new Set<string>();
  const intentEntries = [...intents.entries()];
  for (let i = 0; i < intentEntries.length; i++) {
    const [sessionA, directionA] = intentEntries[i] ?? [];
    if (sessionA === undefined || directionA === undefined) {
      continue;
    }
    const playerA = runtime.players.get(sessionA);
    if (!playerA) {
      continue;
    }
    const targetA = targetPosition(playerA, directionA);
    for (let j = i + 1; j < intentEntries.length; j++) {
      const [sessionB, directionB] = intentEntries[j] ?? [];
      if (sessionB === undefined || directionB === undefined) {
        continue;
      }
      const playerB = runtime.players.get(sessionB);
      if (!playerB) {
        continue;
      }
      const targetB = targetPosition(playerB, directionB);
      if (
        (targetA.x === targetB.x && targetA.y === targetB.y) ||
        (targetA.x === playerB.x &&
          targetA.y === playerB.y &&
          targetB.x === playerA.x &&
          targetB.y === playerA.y)
      ) {
        conflicts.add(sessionA);
        conflicts.add(sessionB);
      }
    }
  }

  const context: ResolutionContext = {
    runtime,
    intents,
    conflicts,
    memo: new Map(),
    planning: new Set(),
  };

  // Fixed-point conflict discovery: plans that overlap (two initiators moving
  // someone to conflicting destinations, or two players ending on one cell)
  // cancel every involved intent, then the remaining plans are recomputed.
  let changed = true;
  while (changed) {
    changed = false;
    context.memo.clear();
    const plans = new Map<string, Plan>();
    for (const sessionId of intents.keys()) {
      if (context.conflicts.has(sessionId)) {
        continue;
      }
      plans.set(sessionId, planForIntent(sessionId, context));
    }
    for (const sessionId of detectConflicts(plans)) {
      if (!context.conflicts.has(sessionId)) {
        context.conflicts.add(sessionId);
        changed = true;
      }
    }
  }

  context.memo.clear();
  const finalPlans = new Map<string, Plan>();
  for (const sessionId of intents.keys()) {
    if (context.conflicts.has(sessionId)) {
      continue;
    }
    finalPlans.set(sessionId, planForIntent(sessionId, context));
  }

  const applied = new Set<string>();
  const ordered = [...intents.keys()].sort((a, b) => {
    const playerA = runtime.players.get(a);
    const playerB = runtime.players.get(b);
    return (playerA?.joinedOrder ?? 0) - (playerB?.joinedOrder ?? 0);
  });
  for (const sessionId of ordered) {
    if (context.conflicts.has(sessionId)) {
      continue;
    }
    const plan = finalPlans.get(sessionId);
    if (plan?.kind !== "success") {
      continue;
    }
    for (const entry of plan.moves) {
      if (applied.has(entry.sessionId)) {
        continue;
      }
      applied.add(entry.sessionId);
      applyMove(runtime, entry, now);
    }
  }

  for (const sessionId of ordered) {
    if (applied.has(sessionId)) {
      continue;
    }
    const player = runtime.players.get(sessionId);
    const direction = intents.get(sessionId);
    if (player && direction !== undefined) {
      applyBounce(runtime, player, direction, now);
    }
  }

  runtime.pendingMoves.clear();
}
