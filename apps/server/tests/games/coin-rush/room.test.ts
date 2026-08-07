import { randomBytes } from "node:crypto";

import {
  COIN_RUSH_CONSTANTS,
  CoinRushState,
  type CoinRushState as CoinRushStateType,
  type ISeatReservation,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
  vehicleLeftEdge,
} from "@phone-party/protocol";
import { matchMaker } from "colyseus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COIN_RUSH_ROOM_TYPE,
  createCoinRushGameDefinition,
} from "../../../src/games/coin-rush/definition.js";
import { createGameRegistry } from "../../../src/games/game-registry.js";
import {
  cookieValue,
  createTestConfig,
  createTestPlatform,
  stopTestPlatform,
  type TestPlatform,
  waitFor,
} from "../../helpers/test-platform.js";

const E2E_CONFIG = { E2E_TEST_MODE: "true" } as const;
const ROOM_CREATION_TOKEN = randomBytes(32).toString("hex");

type MessageRoom = {
  onMessage: (
    type: "*",
    callback: (messageType: string | number, payload: unknown) => void,
  ) => () => void;
};

type SendRoom = {
  send: (type: string, message?: unknown) => void;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function consumeLobby(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LobbyRoomState,
  );
}

async function consumeGame(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(reservation as ISeatReservation, CoinRushState);
}

async function createRoomHttp(test: TestPlatform, name: string) {
  const url = `http://127.0.0.1:${test.testServer.sdk.settings.port}/api/rooms`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ playerName: name }),
  });
  const body = (await response.json()) as { room: { code: string }; reservation: unknown };
  return { body, cookie: cookieValue(response.headers.get("set-cookie")) };
}

async function joinRoomHttp(test: TestPlatform, code: string, name: string) {
  const url = `http://127.0.0.1:${test.testServer.sdk.settings.port}/api/rooms/${code}/join`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ playerName: name }),
  });
  const body = (await response.json()) as {
    room?: { code: string };
    reservation?: unknown;
    error?: { code: string };
  };
  return { body, response };
}

function waitForTransition(room: MessageRoom): Promise<RoomTransition> {
  return new Promise((resolve) => {
    const off = room.onMessage("*", (type, payload) => {
      if (type === ROOM_MESSAGE_TYPES.transition) {
        off();
        resolve(payload as RoomTransition);
      }
    });
  });
}

function waitForRoomError(room: MessageRoom, code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${code}`)), 5_000);
    const off = room.onMessage("*", (type, payload) => {
      if (type === ROOM_MESSAGE_TYPES.error) {
        const error = payload as { code: string; message: string };
        if (error.code === code) {
          clearTimeout(timer);
          off();
          resolve(error.message);
        }
      }
    });
  });
}

function waitForMoveRejection(
  room: MessageRoom,
  sequence: number,
): Promise<{ sequence: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for move rejection ${sequence}`)),
      5_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === "move-rejected") {
        const rejection = payload as { sequence: number; reason: string };
        if (rejection.sequence === sequence) {
          clearTimeout(timer);
          off();
          resolve(rejection);
        }
      }
    });
  });
}

function move(room: SendRoom, sequence: number, direction: "up" | "down" | "left" | "right"): void {
  room.send("game:move", { type: "move", sequence, direction });
}

function isCellCovered(
  state: CoinRushStateType,
  col: number,
  row: number,
  horizonMs: number,
): boolean {
  const rowState = state.rows.find((candidate) => candidate.row === row);
  if (rowState?.terrain !== "road") {
    return false;
  }
  const left = vehicleLeftEdge(rowState, state.elapsedMs + horizonMs);
  const vehicleLeft = left + COIN_RUSH_CONSTANTS.VEHICLE_COLLISION_MARGIN;
  const vehicleRight = left + rowState.vehicleLength - COIN_RUSH_CONSTANTS.VEHICLE_COLLISION_MARGIN;
  const playerLeft = col + COIN_RUSH_CONSTANTS.PLAYER_COLLISION_MARGIN;
  const playerRight = col + 1 - COIN_RUSH_CONSTANTS.PLAYER_COLLISION_MARGIN;
  const maxCopy = Math.ceil((9 + rowState.vehicleLength) / rowState.spacing) + 1;
  for (let copy = -1; copy <= maxCopy; copy++) {
    const copyLeft = vehicleLeft + copy * rowState.spacing;
    const copyRight = vehicleRight + copy * rowState.spacing;
    if (copyLeft < playerRight && copyRight > playerLeft) {
      return true;
    }
  }
  return false;
}

async function waitClear(
  game: SendRoom & { state: CoinRushStateType },
  col: number,
  row: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      !isCellCovered(game.state, col, row, 0) &&
      !isCellCovered(game.state, col, row, 200) &&
      !isCellCovered(game.state, col, row, 350)
    ) {
      return;
    }
    await delay(50);
  }
  throw new Error(`Cell ${col}:${row} never became clear`);
}

async function waitCoveredFor(
  game: SendRoom & { state: CoinRushStateType },
  col: number,
  row: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      isCellCovered(game.state, col, row, 0) &&
      isCellCovered(game.state, col, row, 100) &&
      isCellCovered(game.state, col, row, 200)
    ) {
      return;
    }
    await delay(50);
  }
  throw new Error(`Cell ${col}:${row} never became covered`);
}

async function moveTo(
  game: SendRoom & { state: CoinRushStateType },
  sessionId: string,
  targetCol: number,
  targetRow: number,
  sequences: Map<string, number>,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const local = game.state.players.get(sessionId);
    if (!local?.alive) {
      throw new Error(`Player ${sessionId} is not alive while moving`);
    }
    if (local.x === targetCol && local.y === targetRow) {
      return;
    }
    const dx = targetCol - local.x;
    const dy = targetRow - local.y;
    let direction: "up" | "down" | "left" | "right";
    let nextX: number;
    let nextY: number;
    if (dx !== 0) {
      direction = dx > 0 ? "right" : "left";
      nextX = local.x + Math.sign(dx);
      nextY = local.y;
    } else {
      direction = dy > 0 ? "up" : "down";
      nextX = local.x;
      nextY = local.y + Math.sign(dy);
    }
    if (
      nextX < 0 ||
      nextX >= COIN_RUSH_CONSTANTS.COL_COUNT ||
      nextY < 0 ||
      nextY >= COIN_RUSH_CONSTANTS.ROW_COUNT
    ) {
      throw new Error(`Path left the board at ${nextX}:${nextY}`);
    }
    await waitClear(game, nextX, nextY);
    const current = game.state.players.get(sessionId);
    if (!current || current.x !== local.x || current.y !== local.y) {
      continue;
    }
    const sequence = (sequences.get(sessionId) ?? 0) + 1;
    sequences.set(sessionId, sequence);
    move(game, sequence, direction);
    await waitFor(() => {
      const playerState = game.state.players.get(sessionId);
      return (
        playerState !== undefined &&
        !playerState.moving &&
        (!playerState.alive ||
          (!playerState.bouncing && playerState.x === nextX && playerState.y === nextY))
      );
    }, 10_000).catch((error: unknown) => {
      throw error;
    });
    const afterMove = game.state.players.get(sessionId);
    if (!afterMove?.alive) {
      await waitFor(() => game.state.players.get(sessionId)?.alive === true, 10_000);
      continue;
    }
    if (afterMove.x !== nextX || afterMove.y !== nextY) {
    }
  }
  throw new Error(`Could not reach ${targetCol}:${targetRow}`);
}

async function collectHighestCoin(
  game: SendRoom & { state: CoinRushStateType },
  sessionId: string,
  sequences: Map<string, number>,
): Promise<boolean> {
  const coins = [...game.state.coins.values()].sort((a, b) => b.value - a.value);
  const before = game.state.players.get(sessionId)?.score ?? 0;
  for (const coin of coins) {
    await moveTo(game, sessionId, coin.col, coin.row, sequences);
    const after = game.state.players.get(sessionId)?.score ?? 0;
    if (after > before) {
      return true;
    }
  }
  return false;
}

async function collectUntilRoundEnd(
  game: SendRoom & { state: CoinRushStateType },
  sessionId: string,
  sequences: Map<string, number>,
): Promise<void> {
  for (let attempt = 0; attempt < 60 && game.state.phase === "playing"; attempt++) {
    const collected = await collectHighestCoin(game, sessionId, sequences);
    if (game.state.phase !== "playing") {
      return;
    }
    if (!collected) {
      await delay(100);
    }
  }
  if (game.state.phase === "playing") {
    throw new Error("Round did not end after repeated coin collection");
  }
}

async function waitForPhase(
  game: SendRoom & { state: CoinRushStateType },
  phase: string,
): Promise<void> {
  await waitFor(() => game.state.phase === phase, 20_000);
}

describe("Coin Rush room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createCoinRushGameDefinition(ROOM_CREATION_TOKEN)]),
      createTestConfig(E2E_CONFIG),
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs a complete two-player match through three rounds and play again", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "coin-rush" });
    await waitFor(() => aliceLobby.state.gameId === "coin-rush");

    const aliceTransition = waitForTransition(aliceLobby);
    const bobTransition = waitForTransition(bobLobby);
    aliceLobby.send("start_game", {});
    const [alicePayload, bobPayload] = await Promise.all([aliceTransition, bobTransition]);
    const aliceGame = await consumeGame(test, alicePayload.reservation);
    await waitFor(() => aliceGame.state.players.size === 1);
    expect(aliceGame.state.phase).toBe("lobby");
    expect(aliceGame.state.gameId).toBe("coin-rush");
    const bobGame = await consumeGame(test, bobPayload.reservation);
    await waitFor(() => aliceGame.state.phase === "countdown");
    await waitFor(() => aliceGame.state.phase === "playing");
    await waitForPhase(bobGame, "playing");

    const aliceSession = aliceGame.sessionId;
    const bobSession = bobGame.sessionId;
    expect(aliceGame.state.players.size).toBe(2);
    expect(aliceGame.state.rows.length).toBe(COIN_RUSH_CONSTANTS.ROW_COUNT);
    expect(aliceGame.state.coins.size).toBe(3);
    expect([...aliceGame.state.rows]).toEqual([...bobGame.state.rows]);
    expect([...aliceGame.state.coins.values()].map((coin) => ({ ...coin }))).toEqual(
      [...bobGame.state.coins.values()].map((coin) => ({ ...coin })),
    );

    const sequences = new Map<string, number>();
    for (let round = 1; round <= 3; round++) {
      expect(aliceGame.state.roundNumber).toBe(round);
      expect(bobGame.state.roundNumber).toBe(round);
      // Move Bob to a corner of the safe area first so Alice's coin route
      // does not repeatedly push him through traffic.
      await moveTo(bobGame, bobSession, 8, 0, sequences);
      await collectUntilRoundEnd(aliceGame, aliceSession, sequences);
      await waitForPhase(aliceGame, "round-result");
      await waitForPhase(bobGame, "round-result");
      expect([...aliceGame.state.roundWinnerSessionIds]).toEqual([aliceSession]);
      expect([...bobGame.state.roundWinnerSessionIds]).toEqual([aliceSession]);
      expect(aliceGame.state.players.get(aliceSession)?.roundWins).toBe(round);
      expect(bobGame.state.players.get(aliceSession)?.roundWins).toBe(round);
      if (round < 3) {
        await waitForPhase(aliceGame, "countdown");
        await waitForPhase(bobGame, "countdown");
        await waitForPhase(aliceGame, "playing");
        await waitForPhase(bobGame, "playing");
      }
    }

    await waitForPhase(aliceGame, "finished");
    await waitForPhase(bobGame, "finished");
    expect([...(aliceGame.state.result?.winnerSessionIds ?? [])]).toEqual([aliceSession]);
    expect([...(bobGame.state.result?.winnerSessionIds ?? [])]).toEqual([aliceSession]);
    expect(aliceGame.state.result?.leaderboard.length).toBe(2);

    aliceGame.send("play_again", {});
    await waitForPhase(aliceGame, "countdown");
    await waitForPhase(bobGame, "countdown");
    expect(aliceGame.state.roundNumber).toBe(1);
    expect(bobGame.state.roundNumber).toBe(1);
  }, 180_000);

  it("resolves simultaneous same-destination moves identically on every client", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);
    aliceLobby.send("select_game", { gameId: "coin-rush" });
    await waitFor(() => aliceLobby.state.gameId === "coin-rush");
    const aliceTransition = waitForTransition(aliceLobby);
    const bobTransition = waitForTransition(bobLobby);
    aliceLobby.send("start_game", {});
    const [alicePayload, bobPayload] = await Promise.all([aliceTransition, bobTransition]);
    const aliceGame = await consumeGame(test, alicePayload.reservation);
    const bobGame = await consumeGame(test, bobPayload.reservation);
    await waitForPhase(aliceGame, "playing");
    await waitForPhase(bobGame, "playing");

    const aliceSession = aliceGame.sessionId;
    const bobSession = bobGame.sessionId;
    const sequences = new Map<string, number>();
    await moveTo(aliceGame, aliceSession, 2, 0, sequences);
    await moveTo(bobGame, bobSession, 4, 0, sequences);

    const aliceSequence = (sequences.get(aliceSession) ?? 0) + 1;
    const bobSequence = (sequences.get(bobSession) ?? 0) + 1;
    sequences.set(aliceSession, aliceSequence);
    sequences.set(bobSession, bobSequence);
    aliceGame.send("game:move", {
      type: "move",
      sequence: aliceSequence,
      direction: "right",
    });
    bobGame.send("game:move", {
      type: "move",
      sequence: bobSequence,
      direction: "left",
    });

    await waitFor(() => aliceGame.state.players.get(aliceSession)?.bouncing === true);
    await waitFor(() => bobGame.state.players.get(bobSession)?.bouncing === true);
    expect(aliceGame.state.players.get(aliceSession)?.x).toBe(2);
    expect(aliceGame.state.players.get(aliceSession)?.y).toBe(0);
    expect(aliceGame.state.players.get(bobSession)?.x).toBe(4);
    expect(bobGame.state.players.get(aliceSession)?.x).toBe(2);
    expect(bobGame.state.players.get(bobSession)?.x).toBe(4);
  });

  it("synchronizes a basic push between two real clients", async () => {
    const room = await matchMaker.create(COIN_RUSH_ROOM_TYPE, {
      roomCode: "ABCDEF",
      players: [
        {
          playerId: "11111111-1111-4111-8111-111111111111",
          playerName: "Alice",
          isHost: true,
          joinedOrder: 0,
        },
        {
          playerId: "22222222-2222-4222-8222-222222222222",
          playerName: "Bob",
          isHost: false,
          joinedOrder: 1,
        },
      ],
      e2eMode: true,
      transitionTimeoutMs: 5_000,
      roomCreationToken: ROOM_CREATION_TOKEN,
    });
    const aliceReservation = await matchMaker.joinById(room.roomId, {
      playerId: "11111111-1111-4111-8111-111111111111",
      playerName: "Alice",
    });
    const bobReservation = await matchMaker.joinById(room.roomId, {
      playerId: "22222222-2222-4222-8222-222222222222",
      playerName: "Bob",
    });
    const aliceGame = await consumeGame(test, aliceReservation);
    const bobGame = await consumeGame(test, bobReservation);
    await waitForPhase(aliceGame, "playing");

    const aliceSession = aliceGame.sessionId;
    const bobSession = bobGame.sessionId;
    const sequences = new Map<string, number>();
    await moveTo(aliceGame, aliceSession, 2, 0, sequences);
    await moveTo(bobGame, bobSession, 3, 0, sequences);

    const sequence = (sequences.get(aliceSession) ?? 0) + 1;
    move(aliceGame, sequence, "right");
    await waitFor(() => {
      const alice = aliceGame.state.players.get(aliceSession);
      const bob = aliceGame.state.players.get(bobSession);
      return (
        alice !== undefined &&
        bob !== undefined &&
        !alice.moving &&
        !bob.moving &&
        alice.x === 3 &&
        bob.x === 4
      );
    }, 10_000);

    expect(bobGame.state.players.get(aliceSession)?.x).toBe(3);
    expect(bobGame.state.players.get(bobSession)?.x).toBe(4);
  });

  it("cancels opposing moves from two real clients on every phone", async () => {
    const room = await matchMaker.create(COIN_RUSH_ROOM_TYPE, {
      roomCode: "ABCDEF",
      players: [
        {
          playerId: "11111111-1111-4111-8111-111111111111",
          playerName: "Alice",
          isHost: true,
          joinedOrder: 0,
        },
        {
          playerId: "22222222-2222-4222-8222-222222222222",
          playerName: "Bob",
          isHost: false,
          joinedOrder: 1,
        },
      ],
      e2eMode: true,
      transitionTimeoutMs: 5_000,
      roomCreationToken: ROOM_CREATION_TOKEN,
    });
    const aliceReservation = await matchMaker.joinById(room.roomId, {
      playerId: "11111111-1111-4111-8111-111111111111",
      playerName: "Alice",
    });
    const bobReservation = await matchMaker.joinById(room.roomId, {
      playerId: "22222222-2222-4222-8222-222222222222",
      playerName: "Bob",
    });
    const aliceGame = await consumeGame(test, aliceReservation);
    const bobGame = await consumeGame(test, bobReservation);
    await waitForPhase(aliceGame, "playing");

    const aliceSession = aliceGame.sessionId;
    const bobSession = bobGame.sessionId;
    const sequences = new Map<string, number>();
    await moveTo(aliceGame, aliceSession, 2, 0, sequences);
    await moveTo(bobGame, bobSession, 3, 0, sequences);

    const aliceSequence = (sequences.get(aliceSession) ?? 0) + 1;
    const bobSequence = (sequences.get(bobSession) ?? 0) + 1;
    move(aliceGame, aliceSequence, "right");
    move(bobGame, bobSequence, "left");
    await waitFor(() => aliceGame.state.players.get(aliceSession)?.bouncing === true, 10_000);
    await waitFor(() => bobGame.state.players.get(bobSession)?.bouncing === true, 10_000);
    expect(aliceGame.state.players.get(aliceSession)?.x).toBe(2);
    expect(aliceGame.state.players.get(bobSession)?.x).toBe(3);
    expect(bobGame.state.players.get(aliceSession)?.x).toBe(2);
    expect(bobGame.state.players.get(bobSession)?.x).toBe(3);
  });

  it("rejects forged fields and stale sequences without corrupting state", async () => {
    const room = await matchMaker.create(COIN_RUSH_ROOM_TYPE, {
      roomCode: "ABCDEF",
      players: [
        {
          playerId: "11111111-1111-4111-8111-111111111111",
          playerName: "Alice",
          isHost: true,
          joinedOrder: 0,
        },
        {
          playerId: "22222222-2222-4222-8222-222222222222",
          playerName: "Bob",
          isHost: false,
          joinedOrder: 1,
        },
      ],
      e2eMode: true,
      transitionTimeoutMs: 5_000,
      roomCreationToken: ROOM_CREATION_TOKEN,
    });
    const aliceReservation = await matchMaker.joinById(room.roomId, {
      playerId: "11111111-1111-4111-8111-111111111111",
      playerName: "Alice",
    });
    const bobReservation = await matchMaker.joinById(room.roomId, {
      playerId: "22222222-2222-4222-8222-222222222222",
      playerName: "Bob",
    });
    const aliceGame = await consumeGame(test, aliceReservation);
    const bobGame = await consumeGame(test, bobReservation);
    await waitForPhase(aliceGame, "playing");

    const malformed = waitForRoomError(aliceGame, "INVALID_GAME_COMMAND");
    aliceGame.send("game:move", {
      type: "move",
      sequence: 1,
      direction: "right",
      sessionId: "forged",
      x: 8,
      y: 8,
      score: 99,
    });
    await malformed;

    move(aliceGame, 1, "right");
    await waitFor(() => aliceGame.state.players.get(aliceGame.sessionId)?.x === 1);
    const stale = waitForMoveRejection(aliceGame, 1);
    move(aliceGame, 1, "down");
    expect((await stale).reason).toBe("stale-sequence");
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.x).toBe(1);

    const bobStartX = bobGame.state.players.get(bobGame.sessionId)?.x ?? 0;
    move(bobGame, 1, "up");
    await waitFor(() => bobGame.state.players.get(bobGame.sessionId)?.y === 1);
    expect(aliceGame.state.players.get(bobGame.sessionId)?.y).toBe(1);
    expect(bobGame.state.players.get(aliceGame.sessionId)?.x).toBe(1);
    expect(bobGame.state.players.get(bobGame.sessionId)?.x).toBe(bobStartX);
  });

  it("kills a player who moves into a vehicle and respawns them safely", async () => {
    const room = await matchMaker.create(COIN_RUSH_ROOM_TYPE, {
      roomCode: "ABCDEF",
      players: [
        {
          playerId: "11111111-1111-4111-8111-111111111111",
          playerName: "Alice",
          isHost: true,
          joinedOrder: 0,
        },
        {
          playerId: "22222222-2222-4222-8222-222222222222",
          playerName: "Bob",
          isHost: false,
          joinedOrder: 1,
        },
      ],
      e2eMode: true,
      transitionTimeoutMs: 5_000,
      roomCreationToken: ROOM_CREATION_TOKEN,
    });
    const aliceReservation = await matchMaker.joinById(room.roomId, {
      playerId: "11111111-1111-4111-8111-111111111111",
      playerName: "Alice",
    });
    const bobReservation = await matchMaker.joinById(room.roomId, {
      playerId: "22222222-2222-4222-8222-222222222222",
      playerName: "Bob",
    });
    const aliceGame = await consumeGame(test, aliceReservation);
    await consumeGame(test, bobReservation);
    await waitForPhase(aliceGame, "playing");

    const aliceSession = aliceGame.sessionId;
    let covered: { col: number; row: number } | null = null;
    const staticRow = aliceGame.state.rows.find(
      (rowState) => rowState.row === 4 && rowState.terrain === "road" && rowState.speed === 0,
    );
    if (staticRow && isCellCovered(aliceGame.state, 5, 4, 0)) {
      covered = { col: 5, row: 4 };
    } else {
      for (const rowState of aliceGame.state.rows) {
        if (rowState.terrain !== "road") {
          continue;
        }
        for (let col = 0; col < COIN_RUSH_CONSTANTS.COL_COUNT; col++) {
          if (
            isCellCovered(aliceGame.state, col, rowState.row, 0) &&
            isCellCovered(aliceGame.state, col, rowState.row, 200)
          ) {
            covered = { col, row: rowState.row };
            break;
          }
        }
        if (covered) {
          break;
        }
      }
    }
    if (!covered) {
      throw new Error("No covered road cell found in deterministic E2E map");
    }
    await waitCoveredFor(aliceGame, covered.col, covered.row);

    const neighbor = [
      { col: covered.col - 1, row: covered.row },
      { col: covered.col + 1, row: covered.row },
      { col: covered.col, row: covered.row - 1 },
      { col: covered.col, row: covered.row + 1 },
    ].find(
      (cell) =>
        cell.col >= 0 &&
        cell.col < COIN_RUSH_CONSTANTS.COL_COUNT &&
        cell.row >= 0 &&
        cell.row < COIN_RUSH_CONSTANTS.ROW_COUNT &&
        !isCellCovered(aliceGame.state, cell.col, cell.row, 0) &&
        !isCellCovered(aliceGame.state, cell.col, cell.row, 300),
    );
    if (!neighbor) {
      throw new Error("No clear neighbour for vehicle collision test");
    }
    const sequences = new Map<string, number>();
    await moveTo(aliceGame, aliceSession, neighbor.col, neighbor.row, sequences);
    await waitCoveredFor(aliceGame, covered.col, covered.row);
    const direction =
      covered.col > neighbor.col
        ? "right"
        : covered.col < neighbor.col
          ? "left"
          : covered.row > neighbor.row
            ? "up"
            : "down";
    const sequence = (sequences.get(aliceSession) ?? 0) + 1;
    move(aliceGame, sequence, direction);

    await waitFor(
      () =>
        aliceGame.state.players.get(aliceSession)?.alive === false &&
        aliceGame.state.players.get(aliceSession)?.deathType === "vehicle",
      10_000,
    );
    await waitFor(
      () =>
        aliceGame.state.players.get(aliceSession)?.alive === true &&
        (aliceGame.state.players.get(aliceSession)?.y ?? 99) === 0,
      10_000,
    );
    expect(aliceGame.state.players.get(aliceSession)?.deaths).toBe(1);
  });

  it("recovers a dropped connection within the grace window", async () => {
    const room = await matchMaker.create(COIN_RUSH_ROOM_TYPE, {
      roomCode: "ABCDEF",
      players: [
        {
          playerId: "11111111-1111-4111-8111-111111111111",
          playerName: "Alice",
          isHost: true,
          joinedOrder: 0,
        },
        {
          playerId: "22222222-2222-4222-8222-222222222222",
          playerName: "Bob",
          isHost: false,
          joinedOrder: 1,
        },
      ],
      e2eMode: true,
      transitionTimeoutMs: 5_000,
      roomCreationToken: ROOM_CREATION_TOKEN,
    });
    const aliceReservation = await matchMaker.joinById(room.roomId, {
      playerId: "11111111-1111-4111-8111-111111111111",
      playerName: "Alice",
    });
    const bobReservation = await matchMaker.joinById(room.roomId, {
      playerId: "22222222-2222-4222-8222-222222222222",
      playerName: "Bob",
    });
    const aliceGame = await consumeGame(test, aliceReservation);
    const bobGame = await consumeGame(test, bobReservation);
    await waitForPhase(aliceGame, "playing");
    // Colyseus refuses reconnection before the room has been up five seconds;
    // wait past that minimum so the reconnect path is exercised for real.
    await delay(5_500);

    const aliceSession = aliceGame.sessionId;
    aliceGame.connection.close();
    await waitFor(() => bobGame.state.players.get(aliceSession)?.connected === false);
    await waitFor(() => aliceGame.reconnectionToken !== undefined);

    const token = aliceGame.reconnectionToken;
    expect(token).toBeDefined();
    if (token === undefined) {
      throw new Error("Missing reconnection token");
    }
    const reconnected = await test.testServer.sdk.reconnect(token, CoinRushState);
    await waitFor(() => bobGame.state.players.get(aliceSession)?.connected === true);
    await waitFor(
      () => reconnected.state.players.get(reconnected.sessionId)?.alive === true,
      10_000,
    );
    move(reconnected, 1, "up");
    await waitFor(() => bobGame.state.players.get(aliceSession)?.y === 1, 5_000);
  });

  it("starts an eight-player roster and keeps all players on unique cells", async () => {
    const players = Array.from({ length: 8 }, (_, index) => ({
      playerId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      playerName: `Player ${index}`,
      isHost: index === 0,
      joinedOrder: index,
    }));
    const room = await matchMaker.create(COIN_RUSH_ROOM_TYPE, {
      roomCode: "ABCDEF",
      players,
      e2eMode: true,
      transitionTimeoutMs: 5_000,
      roomCreationToken: ROOM_CREATION_TOKEN,
    });
    const reservations = [];
    for (const player of players) {
      reservations.push(
        await matchMaker.joinById(room.roomId, {
          playerId: player.playerId,
          playerName: player.playerName,
        }),
      );
    }
    const hostRoom = await consumeGame(test, reservations[0]);
    for (const reservation of reservations.slice(1)) {
      await consumeGame(test, reservation);
    }
    await waitForPhase(hostRoom, "playing");
    expect(hostRoom.state.players.size).toBe(8);
    const cells = [...hostRoom.state.players.values()].map((player) => `${player.x}:${player.y}`);
    expect(new Set(cells).size).toBe(8);
    expect([...hostRoom.state.players.values()].every((player) => player.alive)).toBe(true);
  });

  it("rejects starting the transition with fewer than the minimum players", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    aliceLobby.send("select_game", { gameId: "coin-rush" });
    await waitFor(() => aliceLobby.state.gameId === "coin-rush");
    const notEnough = waitForRoomError(aliceLobby, "NOT_ENOUGH_PLAYERS");
    aliceLobby.send("start_game", {});
    await notEnough;
    expect(test.platform.roomDirectory.getByCode(created.body.room.code)).toBeDefined();
  });

  it("rejects direct matchmaking creation without the server room token", async () => {
    await expect(
      matchMaker.create(COIN_RUSH_ROOM_TYPE, {
        roomCode: "ABCDEF",
        players: [
          {
            playerId: "11111111-1111-4111-8111-111111111111",
            playerName: "Alice",
            isHost: true,
            joinedOrder: 0,
          },
        ],
      }),
    ).rejects.toThrow();
  });
});
