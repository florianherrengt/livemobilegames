import type { Client, Room } from "@colyseus/sdk";
import {
  COIN_RUSH_CONSTANTS,
  COIN_RUSH_GAME_ID,
  CoinRushCoinState,
  type CoinRushPhase,
  CoinRushPlayerState,
  CoinRushResultEntryState,
  CoinRushResultState,
  CoinRushRowState,
  CoinRushState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

function addRow(state: CoinRushState, row: number, terrain: "safe" | "road"): void {
  const rowState = new CoinRushRowState();
  rowState.row = row;
  rowState.terrain = terrain;
  if (terrain === "road") {
    rowState.direction = row % 2 === 0 ? 1 : -1;
    rowState.speed = row < 7 ? 1 : row < 12 ? 2 : 3;
    rowState.vehicleLength = row < 7 ? 1 : 2;
    rowState.spacing = row < 7 ? 10 : 8;
    rowState.offset = (row * 3) % rowState.spacing;
  }
  state.rows.push(rowState);
}

function addPlayer(
  state: CoinRushState,
  sessionId: string,
  name: string,
  joinedOrder: number,
  color: string,
  options: {
    alive?: boolean;
    moving?: boolean;
    x?: number;
    y?: number;
    score?: number;
    roundWins?: number;
    deaths?: number;
    respawning?: boolean;
    connectionStatus?: "connected" | "reconnecting" | "disconnected";
  } = {},
): void {
  const player = new CoinRushPlayerState();
  player.name = name;
  player.connected = options.connectionStatus !== "disconnected";
  player.joinedOrder = joinedOrder;
  player.color = color;
  player.alive = options.alive ?? true;
  player.x = options.x ?? (joinedOrder === 0 ? 0 : 4);
  player.y = options.y ?? joinedOrder % 2;
  player.fromX = player.x;
  player.fromY = player.y;
  player.toX = player.x;
  player.toY = player.y;
  player.score = options.score ?? 0;
  player.roundWins = options.roundWins ?? 0;
  player.deaths = options.deaths ?? 0;
  player.respawning = options.respawning ?? false;
  state.players.set(sessionId, player);
}

function addCoin(state: CoinRushState, value: 1 | 3 | 5, col: number, row: number): void {
  const coin = new CoinRushCoinState();
  coin.value = value;
  coin.col = col;
  coin.row = row;
  coin.visibleAt = 0;
  state.coins.set(String(value), coin);
}

/** Deterministic Coin Rush state for Storybook and component tests. */
export function makeCoinRushState(
  phase: CoinRushPhase,
  options: {
    roundNumber?: number;
    hostSessionId?: string;
    aliceScore?: number;
    bobScore?: number;
    aliceRoundWins?: number;
    bobRoundWins?: number;
    aliceAlive?: boolean;
    bobAlive?: boolean;
    aliceRespawning?: boolean;
    suddenDeath?: boolean;
    result?: CoinRushResultState | null;
  } = {},
): CoinRushState {
  const state = new CoinRushState();
  state.roomCode = "ABC234";
  state.gameId = COIN_RUSH_GAME_ID;
  state.phase = phase;
  state.hostSessionId = options.hostSessionId ?? "host-session";
  state.roundNumber = options.roundNumber ?? (phase === "lobby" ? 0 : 1);
  state.totalRounds = COIN_RUSH_CONSTANTS.TOTAL_ROUNDS;
  state.suddenDeath = options.suddenDeath ?? false;
  if (phase === "countdown") {
    state.countdownEndsAt = Date.now() + 2_000;
  }
  if (phase === "round-result") {
    state.roundResultEndsAt = Date.now() + 1_000;
    state.roundWinnerSessionIds.push("host-session");
  }
  for (let row = 0; row < COIN_RUSH_CONSTANTS.ROW_COUNT; row++) {
    addRow(state, row, row < 2 || row === 4 || row === 6 ? "safe" : "road");
  }
  addCoin(state, 1, 3, 5);
  addCoin(state, 3, 6, 10);
  addCoin(state, 5, 4, 15);
  addPlayer(state, "host-session", "Alice", 0, "#0072B2", {
    alive: options.aliceAlive ?? phase !== "finished",
    respawning: options.aliceRespawning ?? false,
    score: options.aliceScore ?? 0,
    roundWins: options.aliceRoundWins ?? 0,
  });
  addPlayer(state, "bob-session", "Bob", 1, "#E69F00", {
    alive: options.bobAlive ?? phase !== "finished",
    score: options.bobScore ?? 0,
    roundWins: options.bobRoundWins ?? 0,
  });
  state.result = options.result ?? null;
  return state;
}

export function makeCoinRushResult(options: { tie?: boolean } = {}): CoinRushResultState {
  const result = new CoinRushResultState();
  result.winnerSessionIds.push("host-session");
  if (options.tie) {
    result.winnerSessionIds.push("bob-session");
  }
  const alice = new CoinRushResultEntryState();
  alice.sessionId = "host-session";
  alice.rank = 1;
  alice.roundWins = 2;
  alice.totalCoins = 12;
  alice.deaths = 1;
  alice.label = "Alice";
  result.leaderboard.push(alice);
  const bob = new CoinRushResultEntryState();
  bob.sessionId = "bob-session";
  bob.rank = options.tie ? 1 : 2;
  bob.roundWins = options.tie ? 2 : 1;
  bob.totalCoins = options.tie ? 12 : 9;
  bob.deaths = options.tie ? 1 : 2;
  bob.label = "Bob";
  result.leaderboard.push(bob);
  return result;
}

/** A fake connection whose room records sent messages for assertions. */
export function makeRoomConnection(state: CoinRushState) {
  const sent: Array<{ type: string; payload: unknown }> = [];
  const room = {
    state,
    sessionId: "host-session",
    send: (type: string, payload?: unknown) => {
      sent.push({ type, payload });
    },
    onMessage: () => () => undefined,
    onError: { once: () => undefined },
  } as unknown as Room<unknown, RoomState>;
  const client = {} as Client;
  const connection = {
    code: "ABC234",
    room,
    client,
    reconnecting: false,
    leave: () => undefined,
  } as unknown as RoomConnection;
  return { connection, sent };
}
