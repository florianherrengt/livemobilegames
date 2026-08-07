import {
  CoinRushCoinState,
  CoinRushPlayerState,
  CoinRushResultEntryState,
  CoinRushResultState,
  CoinRushRowState,
  type CoinRushState,
} from "@phone-party/protocol";

import type { CoinRushRuntime, RuntimeCoin, RuntimePlayer } from "./types.js";

function copyPlayer(target: CoinRushPlayerState, source: RuntimePlayer): void {
  target.name = source.name;
  target.connected = source.connected;
  target.joinedOrder = source.joinedOrder;
  target.color = source.color;
  target.alive = source.alive;
  target.respawning = source.respawning;
  target.respawnEndsAt = source.respawnEndsAt;
  target.moving = source.moving;
  target.push = source.push;
  target.bouncing = source.bouncing;
  target.x = source.x;
  target.y = source.y;
  target.fromX = source.fromX;
  target.fromY = source.fromY;
  target.toX = source.toX;
  target.toY = source.toY;
  target.moveStartedAt = source.moveStartedAt;
  target.moveEndsAt = source.moveEndsAt;
  target.bounceStartedAt = source.bounceStartedAt;
  target.bounceEndsAt = source.bounceEndsAt;
  target.deathType = source.deathType;
  target.diedAt = source.diedAt;
  target.score = source.score;
  target.roundWins = source.roundWins;
  target.totalCoins = source.totalCoins;
  target.deaths = source.deaths;
  target.suddenDeathEligible = source.suddenDeathEligible;
}

function copyRow(target: CoinRushRowState, source: CoinRushRuntime["rows"][number]): void {
  target.row = source.row;
  target.terrain = source.terrain;
  target.direction = source.direction;
  target.speed = source.speed;
  target.vehicleLength = source.vehicleLength;
  target.spacing = source.spacing;
  target.offset = source.offset;
}

function copyCoin(target: CoinRushCoinState, source: RuntimeCoin): void {
  target.value = source.value;
  target.col = source.col;
  target.row = source.row;
  target.visibleAt = source.visibleAt;
}

function toResultState(source: NonNullable<CoinRushRuntime["result"]>): CoinRushResultState {
  const state = new CoinRushResultState();
  for (const sessionId of source.winnerSessionIds) {
    state.winnerSessionIds.push(sessionId);
  }
  for (const entry of source.leaderboard) {
    const row = new CoinRushResultEntryState();
    row.sessionId = entry.sessionId;
    row.rank = entry.rank;
    row.roundWins = entry.roundWins;
    row.totalCoins = entry.totalCoins;
    row.deaths = entry.deaths;
    row.label = entry.label;
    state.leaderboard.push(row);
  }
  return state;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes client-facing Coin Rush state, and it never exposes
 * the seed, RNG, pending move queue, sequence windows, rate-limit state, or
 * respawn candidate rolls.
 */
export function syncCoinRushState(state: CoinRushState, runtime: CoinRushRuntime): void {
  state.phase = runtime.phase;
  state.roundNumber = runtime.roundNumber;
  state.totalRounds = runtime.totalRounds;
  state.countdownEndsAt = runtime.phase === "countdown" ? runtime.countdownEndsAt : 0;
  state.roundResultEndsAt = runtime.phase === "round-result" ? runtime.roundResultEndsAt : 0;
  state.elapsedMs = runtime.phase === "playing" ? runtime.elapsedMs : 0;
  state.suddenDeath = runtime.phase === "playing" && runtime.suddenDeath;

  if (runtime.phase === "lobby") {
    state.rows.clear();
    state.coins.clear();
  } else {
    state.rows.clear();
    for (const row of runtime.rows) {
      const rowState = new CoinRushRowState();
      copyRow(rowState, row);
      state.rows.push(rowState);
    }

    for (const [value, coin] of runtime.coins) {
      let coinState = state.coins.get(value);
      if (!coinState) {
        coinState = new CoinRushCoinState();
        state.coins.set(value, coinState);
      }
      copyCoin(coinState, coin);
    }
    for (const key of [...state.coins.keys()]) {
      if (!runtime.coins.has(key)) {
        state.coins.delete(key);
      }
    }
  }

  for (const [sessionId, player] of runtime.players) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new CoinRushPlayerState();
      state.players.set(sessionId, playerState);
    }
    copyPlayer(playerState, player);
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.players.has(key)) {
      state.players.delete(key);
    }
  }

  state.roundWinnerSessionIds.clear();
  for (const sessionId of runtime.roundWinnerSessionIds) {
    state.roundWinnerSessionIds.push(sessionId);
  }

  if (runtime.result === null) {
    state.result = null;
  } else if (state.result === null) {
    state.result = toResultState(runtime.result);
  }
}
