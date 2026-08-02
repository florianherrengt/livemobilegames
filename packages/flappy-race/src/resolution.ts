import type { RoundProgressCandidate } from "./types.js";

export type RoundResolutionReason =
  | "all-eliminated"
  | "survivor-proved"
  | "sole-eligible"
  | "no-eligible";

export type RoundResolution =
  | { outcome: "continue" }
  | { outcome: "resolved"; winnerSessionIds: string[]; reason: RoundResolutionReason };

/**
 * Authoritative round resolution. Only fully cleared obstacles decide the
 * outcome; packet arrival order, elimination order, vertical position and
 * survival time are never considered.
 *
 * Rules:
 * - All eligible players are considered; players removed from the match
 *   (disconnects) are not eligible.
 * - When nobody is active, everyone with the maximum cleared count wins.
 * - A sole survivor wins immediately once their cleared count exceeds the
 *   highest cleared count among eligible eliminated players.
 * - When the sole remaining valid participant is alone (all others
 *   disconnected), the round resolves in their favour so the match cannot get
 *   stuck.
 * - When nobody is eligible (everyone disconnected), the round resolves with
 *   no winners.
 */
export function resolveRound(candidates: readonly RoundProgressCandidate[]): RoundResolution {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) {
    return { outcome: "resolved", winnerSessionIds: [], reason: "no-eligible" };
  }

  const active = eligible.filter((candidate) => candidate.roundActive);
  if (active.length === 0) {
    const maxProgress = Math.max(...eligible.map((candidate) => candidate.clearedObstacleCount));
    return {
      outcome: "resolved",
      winnerSessionIds: eligible
        .filter((candidate) => candidate.clearedObstacleCount === maxProgress)
        .map((candidate) => candidate.sessionId),
      reason: "all-eliminated",
    };
  }

  if (active.length === 1 && eligible.length === 1) {
    const survivor = active[0];
    if (survivor) {
      return {
        outcome: "resolved",
        winnerSessionIds: [survivor.sessionId],
        reason: "sole-eligible",
      };
    }
  }

  if (active.length === 1) {
    const survivor = active[0];
    const highestEliminatedProgress = eligible
      .filter((candidate) => !candidate.roundActive)
      .reduce((highest, candidate) => Math.max(highest, candidate.clearedObstacleCount), 0);
    if (survivor && survivor.clearedObstacleCount > highestEliminatedProgress) {
      return {
        outcome: "resolved",
        winnerSessionIds: [survivor.sessionId],
        reason: "survivor-proved",
      };
    }
  }

  return { outcome: "continue" };
}
