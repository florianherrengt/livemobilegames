import { spawnCoin } from "./coins.js";
import type { CoinRushRuntime, RuntimePlayer, RuntimeResult } from "./types.js";

/**
 * Awards coins to every surviving player who finished a resolved movement on
 * a coin cell. Only one player can collect a given coin; chain pushes can
 * collect multiple coins in one resolution when different players land on
 * different cells.
 */
export function awardCoins(runtime: CoinRushRuntime, now: number): Set<string> {
  const collectedBy = new Set<string>();
  for (const player of runtime.players.values()) {
    if (!player.alive) {
      continue;
    }
    const cellX = player.moving ? player.toX : player.x;
    const cellY = player.moving ? player.toY : player.y;
    const coin = [...runtime.coins.values()].find(
      (candidate) => candidate.col === cellX && candidate.row === cellY,
    );
    if (!coin) {
      continue;
    }
    if (runtime.suddenDeath && !player.suddenDeathEligible) {
      continue;
    }
    runtime.coins.delete(String(coin.value));
    player.score += coin.value;
    player.totalCoins += coin.value;
    collectedBy.add(player.sessionId);
    spawnReplacement(runtime, coin.value, coin.col, coin.row, player, now);
  }
  return collectedBy;
}

function spawnReplacement(
  runtime: CoinRushRuntime,
  value: 1 | 3 | 5,
  oldCol: number,
  oldRow: number,
  collector: RuntimePlayer,
  now: number,
): void {
  spawnCoin(runtime, value, {
    excludeCell: { col: oldCol, row: oldRow },
    collector,
    now,
  });
}

export function roundCandidates(
  runtime: CoinRushRuntime,
  collectedThisResolution: ReadonlySet<string>,
): RuntimePlayer[] {
  if (runtime.suddenDeath) {
    return [...runtime.players.values()].filter(
      (player) =>
        player.alive && player.suddenDeathEligible && collectedThisResolution.has(player.sessionId),
    );
  }
  return [...runtime.players.values()].filter((player) => player.alive && player.score >= 10);
}

/**
 * Picks the round winner among candidates that reached the threshold in one
 * resolution. Highest resulting score wins; equal scores are broken by fewer
 * current-round deaths. When candidates are still exactly tied, the round
 * continues in sudden death for only those players.
 */
export function resolveThreshold(
  runtime: CoinRushRuntime,
  candidates: readonly RuntimePlayer[],
): { winners: RuntimePlayer[]; suddenDeath: boolean } {
  if (candidates.length === 0) {
    return { winners: [], suddenDeath: runtime.suddenDeath };
  }
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.roundDeaths - b.roundDeaths);
  const best = sorted[0];
  if (!best) {
    return { winners: [], suddenDeath: runtime.suddenDeath };
  }
  const winners = sorted.filter(
    (player) => player.score === best.score && player.roundDeaths === best.roundDeaths,
  );
  if (winners.length === 1) {
    return { winners, suddenDeath: false };
  }
  return { winners, suddenDeath: true };
}

/**
 * Builds the final match result. Ranking order is most round wins, then most
 * total coin points, then fewest deaths. Players still exactly tied share the
 * match victory.
 */
export function buildResult(runtime: CoinRushRuntime): RuntimeResult {
  const entries = [...runtime.players.values()]
    .map((player) => ({
      sessionId: player.sessionId,
      roundWins: player.roundWins,
      totalCoins: player.totalCoins,
      deaths: player.deaths,
      label: player.name,
    }))
    .sort(
      (a, b) =>
        b.roundWins - a.roundWins ||
        b.totalCoins - a.totalCoins ||
        a.deaths - b.deaths ||
        a.label.localeCompare(b.label, "en"),
    );

  const leaderboard: RuntimeResult["leaderboard"] = entries.reduce(
    (acc, entry, index) => {
      const previous = acc[index - 1];
      const sameRank =
        previous !== undefined &&
        previous.roundWins === entry.roundWins &&
        previous.totalCoins === entry.totalCoins &&
        previous.deaths === entry.deaths;
      acc.push({
        sessionId: entry.sessionId,
        rank: sameRank ? (previous?.rank ?? index + 1) : index + 1,
        roundWins: entry.roundWins,
        totalCoins: entry.totalCoins,
        deaths: entry.deaths,
        label: entry.label,
      });
      return acc;
    },
    [] as RuntimeResult["leaderboard"],
  );

  const top = leaderboard[0];
  return {
    winnerSessionIds: top
      ? leaderboard
          .filter(
            (entry) =>
              entry.rank === top.rank &&
              entry.roundWins === top.roundWins &&
              entry.totalCoins === top.totalCoins &&
              entry.deaths === top.deaths,
          )
          .map((entry) => entry.sessionId)
      : [],
    leaderboard,
  };
}
