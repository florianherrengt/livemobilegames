import { randomBytes } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import {
  type ISeatReservation,
  LobbyRoomState,
  MEMORY_PATH_CONSTANTS,
  MEMORY_PATH_MESSAGE_TYPES,
  MemoryPathState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameRegistry } from "../../../src/games/game-registry.js";
import {
  createMemoryPathGameDefinition,
  MEMORY_PATH_ROOM_TYPE,
} from "../../../src/games/memory-path/definition.js";
import {
  cookieValue,
  createTestConfig,
  createTestPlatform,
  stopTestPlatform,
  type TestPlatform,
  waitFor,
} from "../../helpers/test-platform.js";

const E2E_CONFIG = { E2E_TEST_MODE: "true" } as const;
const MEMORY_PATH_TEST_CONFIG = createTestConfig({
  ...E2E_CONFIG,
  PORT: "2578",
  PUBLIC_ORIGIN: "http://127.0.0.1:2578",
});
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

type GameRoom = SendRoom & {
  onMessage: MessageRoom["onMessage"];
  state: MemoryPathState;
  sessionId: string;
  reconnectionToken?: string;
  connection: { close: () => void };
  leave: () => Promise<void>;
};

function makeMover(): { next: () => number } {
  let sequence = 0;
  return {
    next: () => {
      sequence += 1;
      return sequence;
    },
  };
}

async function consumeLobby(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LobbyRoomState,
  );
}

async function consumeGame(test: TestPlatform, reservation: unknown): Promise<GameRoom> {
  return (await test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    MemoryPathState,
  )) as unknown as GameRoom;
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
): Promise<{ sequence: number; roundNumber: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for move rejection ${sequence}`)),
      5_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === MEMORY_PATH_MESSAGE_TYPES.moveRejected) {
        const rejection = payload as { sequence: number; roundNumber: number; reason: string };
        if (rejection.sequence === sequence) {
          clearTimeout(timer);
          off();
          resolve(rejection);
        }
      }
    });
  });
}

function move(room: SendRoom, sequence: number, roundNumber: number, x: number, y: number): void {
  room.send(MEMORY_PATH_MESSAGE_TYPES.move, {
    type: "move",
    sequence,
    roundNumber,
    x,
    y,
  });
}

function playerIds(count: number): Array<{
  playerId: string;
  playerName: string;
  isHost: boolean;
  joinedOrder: number;
}> {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    playerName: `Player ${index}`,
    isHost: index === 0,
    joinedOrder: index,
  }));
}

async function createDirectRoom(count = 2) {
  const players = playerIds(count);
  const room = await matchMaker.create(MEMORY_PATH_ROOM_TYPE, {
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
  return { room, players, reservations };
}

async function waitForPhase(room: GameRoom, phase: string, timeout = 15_000): Promise<void> {
  await waitFor(() => room.state.phase === phase, timeout);
}

async function driveToFinish(
  room: GameRoom,
  roundNumber: number,
  sessionId: string,
  mover: ReturnType<typeof makeMover>,
): Promise<void> {
  const points = [...room.state.routePoints].map((point) => ({
    x: point.x,
    y: point.y,
  }));
  for (let index = 1; index < points.length; index++) {
    const target = points[index];
    if (!target) {
      continue;
    }
    while (true) {
      const player = room.state.players.get(sessionId);
      if (!player) {
        throw new Error(`Player ${sessionId} missing while driving`);
      }
      const dx = target.x - player.positionX;
      const dy = target.y - player.positionY;
      const distance = Math.hypot(dx, dy);
      if (distance <= 26 || player.finished) {
        break;
      }
      move(room, mover.next(), roundNumber, dx / distance, dy / distance);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    move(room, mover.next(), roundNumber, 0, 0);
  }
  await waitFor(() => room.state.phase === "round-result", 10_000);
}

describe("Memory Path room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createMemoryPathGameDefinition(ROOM_CREATION_TOKEN)]),
      MEMORY_PATH_TEST_CONFIG,
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs the full lobby-to-game transition, three-round match, and play-again flow", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "memory-path" });
    await waitFor(() => aliceLobby.state.gameId === "memory-path");

    const bobStartError = waitForRoomError(bobLobby, "NOT_HOST");
    bobLobby.send("start_game", {});
    await bobStartError;

    const aliceTransition = waitForTransition(aliceLobby);
    const bobTransition = waitForTransition(bobLobby);
    aliceLobby.send("start_game", {});

    const [alicePayload, bobPayload] = await Promise.all([aliceTransition, bobTransition]);
    const aliceGame = await consumeGame(test, alicePayload.reservation);
    const bobGame = await consumeGame(test, bobPayload.reservation);
    await waitFor(() => aliceGame.state.players.size === 2);
    await waitForPhase(aliceGame, "preparing");
    await waitForPhase(bobGame, "preparing");

    expect(aliceGame.state.roomCode).toBe(created.body.room.code);
    expect(aliceGame.state.gameId).toBe("memory-path");
    expect(aliceGame.state.totalRounds).toBe(MEMORY_PATH_CONSTANTS.NORMAL_ROUNDS);
    expect(aliceGame.state.routePoints.length).toBeGreaterThan(2);
    expect(aliceGame.state.landmarks.length).toBeGreaterThanOrEqual(6);
    expect(aliceGame.state.routePoints.length).toBe(bobGame.state.routePoints.length);
    expect("seed" in aliceGame.state).toBe(false);

    await waitForPhase(aliceGame, "preview");
    expect(aliceGame.state.pathVisible).toBe(true);
    expect(aliceGame.state.opponentsVisible).toBe(true);
    expect(bobGame.state.pathVisible).toBe(true);
    await waitForPhase(aliceGame, "racing");
    expect(aliceGame.state.pathVisible).toBe(false);
    expect(bobGame.state.pathVisible).toBe(false);

    const mover = makeMover();
    await driveToFinish(aliceGame, 1, aliceGame.sessionId, mover);
    await waitForPhase(bobGame, "round-result");
    expect([...(aliceGame.state.roundResult?.winnerSessionIds ?? [])]).toEqual([
      aliceGame.sessionId,
    ]);
    expect([...(bobGame.state.roundResult?.winnerSessionIds ?? [])]).toEqual([aliceGame.sessionId]);

    await waitForPhase(aliceGame, "preparing");
    await waitForPhase(aliceGame, "preview");
    await waitForPhase(aliceGame, "racing");
    await driveToFinish(aliceGame, 2, aliceGame.sessionId, mover);
    await waitForPhase(bobGame, "round-result");

    await waitForPhase(aliceGame, "preparing");
    await waitForPhase(aliceGame, "preview");
    await waitForPhase(aliceGame, "racing");
    await driveToFinish(aliceGame, 3, aliceGame.sessionId, mover);
    await waitForPhase(aliceGame, "match-result", 15_000);
    await waitForPhase(bobGame, "match-result", 15_000);

    const result = aliceGame.state.matchResult;
    if (result === null) {
      throw new Error("Expected a match result");
    }
    expect([...result.winnerSessionIds]).toEqual([aliceGame.sessionId]);
    expect(result.suddenDeathUsed).toBe(false);
    expect(result.roundResults.length).toBe(3);
    const aliceEntry = [...result.leaderboard].find(
      (entry) => entry.sessionId === aliceGame.sessionId,
    );
    const bobEntry = [...result.leaderboard].find((entry) => entry.sessionId === bobGame.sessionId);
    expect(aliceEntry?.roundWins).toBe(3);
    expect(bobEntry?.roundWins).toBe(0);

    const nonHostAgain = waitForRoomError(bobGame, "NOT_HOST");
    bobGame.send("play_again", {});
    await nonHostAgain;
    aliceGame.send("play_again", {});
    await waitForPhase(aliceGame, "preparing");
    await waitForPhase(bobGame, "preparing");
    expect(aliceGame.state.roundNumber).toBe(1);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.roundWins).toBe(0);
  }, 90_000);

  it("lets both players control only their own character and finish different rounds", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitForPhase(alice, "racing");

    const aliceYBefore = alice.state.players.get(alice.sessionId)?.positionY ?? 0;
    const bobYBefore = bob.state.players.get(bob.sessionId)?.positionY ?? 0;
    move(alice, 1, 1, 0, -1);
    await waitFor(() => (alice.state.players.get(alice.sessionId)?.positionY ?? 0) < aliceYBefore);
    expect(bob.state.players.get(bob.sessionId)?.positionY).toBe(bobYBefore);
    await waitFor(() => (bob.state.players.get(alice.sessionId)?.positionY ?? 0) < aliceYBefore);

    const mover = makeMover();
    await driveToFinish(alice, 1, alice.sessionId, mover);
    await waitForPhase(alice, "preparing");
    await waitForPhase(alice, "preview");
    await waitForPhase(alice, "racing");
    await waitForPhase(bob, "racing");
    await driveToFinish(bob, 2, bob.sessionId, mover);
    await waitForPhase(alice, "round-result");
    await waitFor(
      () => [...(alice.state.roundResult?.winnerSessionIds ?? [])].join("|") === bob.sessionId,
    );

    await waitForPhase(alice, "preparing");
    await waitForPhase(alice, "preview");
    await waitForPhase(alice, "racing");
    await waitForPhase(alice, "round-result", 20_000);
    await waitForPhase(alice, "match-result", 15_000);
    const result = alice.state.matchResult;
    expect([...(result?.winnerSessionIds ?? [])]).toEqual([alice.sessionId]);
    const aliceEntry = [...(result?.leaderboard ?? [])].find(
      (entry) => entry.sessionId === alice.sessionId,
    );
    expect(aliceEntry?.roundWins).toBe(2);
  }, 90_000);

  it("resolves simultaneous inputs without player collision and keeps every client in sync", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitForPhase(alice, "racing");
    await waitForPhase(bob, "racing");

    const aliceBefore = alice.state.players.get(alice.sessionId)?.positionY ?? 0;
    const bobBefore = bob.state.players.get(bob.sessionId)?.positionY ?? 0;
    move(alice, 1, 1, 0, -1);
    move(bob, 1, 1, 0, -1);

    await waitFor(
      () =>
        (alice.state.players.get(alice.sessionId)?.positionY ?? 0) < aliceBefore &&
        (alice.state.players.get(bob.sessionId)?.positionY ?? 0) < bobBefore,
    );
    expect((bob.state.players.get(alice.sessionId)?.positionY ?? 0) < aliceBefore).toBe(true);
    expect((bob.state.players.get(bob.sessionId)?.positionY ?? 0) < bobBefore).toBe(true);
    expect(alice.state.players.get(alice.sessionId)?.falling).toBe(false);
    expect(alice.state.players.get(bob.sessionId)?.falling).toBe(false);
  });

  it("runs a full match with the maximum eight players and sudden death", async () => {
    const { reservations } = await createDirectRoom(8);
    const clients = [];
    for (const reservation of reservations) {
      clients.push(await consumeGame(test, reservation));
    }
    const first = clients[0];
    if (!first) {
      throw new Error("First client missing");
    }
    await waitForPhase(first, "preparing");
    expect(first.state.players.size).toBe(8);
    for (const client of clients) {
      await waitForPhase(client, "preparing");
    }

    const mover = makeMover();
    for (let round = 1; round <= 3; round++) {
      await waitForPhase(first, "preview");
      await waitForPhase(first, "racing");
      const winner = clients[round - 1];
      if (!winner) {
        throw new Error("Winner client missing");
      }
      await driveToFinish(winner, round, winner.sessionId, mover);
      await waitForPhase(first, "round-result");
      expect([...(first.state.roundResult?.winnerSessionIds ?? [])]).toEqual([winner.sessionId]);
      for (const client of clients) {
        await waitFor(
          () =>
            [...(client.state.roundResult?.winnerSessionIds ?? [])].join("|") === winner.sessionId,
        );
      }
    }

    await waitForPhase(first, "preparing", 15_000);
    expect(first.state.suddenDeath).toBe(true);
    expect(first.state.roundNumber).toBe(4);
    const participants = clients.slice(0, 3).map((client) => client.sessionId);
    for (const client of clients) {
      expect(client.state.players.get(client.sessionId)?.participating).toBe(
        participants.includes(client.sessionId),
      );
    }

    await waitForPhase(first, "preview");
    await waitForPhase(first, "racing");
    const suddenDeathWinner = clients[0];
    if (!suddenDeathWinner) {
      throw new Error("Sudden-death winner client missing");
    }
    await driveToFinish(suddenDeathWinner, 4, suddenDeathWinner.sessionId, mover);
    await waitForPhase(first, "match-result", 15_000);
    for (const client of clients) {
      await waitForPhase(client, "match-result", 15_000);
    }
    const result = first.state.matchResult;
    if (result === null) {
      throw new Error("Expected a match result");
    }
    expect(result.suddenDeathUsed).toBe(true);
    expect([...result.winnerSessionIds]).toEqual([suddenDeathWinner.sessionId]);
    expect(result.leaderboard.length).toBe(8);
    for (const client of clients) {
      const clientResult = client.state.matchResult;
      expect([...(clientResult?.winnerSessionIds ?? [])]).toEqual([suddenDeathWinner.sessionId]);
      expect(clientResult?.leaderboard.length).toBe(8);
      expect(clientResult?.roundResults.length).toBe(4);
    }
  }, 120_000);

  it("rejects invalid, stale, and spectator moves and never trusts client positions", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    await consumeGame(test, reservations[1]);
    await waitForPhase(alice, "racing");

    const invalidCommand = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send(MEMORY_PATH_MESSAGE_TYPES.move, { command: { type: "teleport" } });
    await invalidCommand;

    const cheat = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send(MEMORY_PATH_MESSAGE_TYPES.move, {
      type: "move",
      sequence: 2,
      roundNumber: 1,
      x: 0,
      y: -1,
      positionX: 0,
      positionY: 0,
      winner: true,
    });
    await cheat;

    const oldRound = waitForMoveRejection(alice, 3);
    move(alice, 3, 99, 0, -1);
    expect((await oldRound).reason).toBe("old-round");

    move(alice, 4, 1, 0, -1);
    const stale = waitForMoveRejection(alice, 4);
    move(alice, 4, 1, 0, -1);
    expect((await stale).reason).toBe("stale-sequence");

    await waitForPhase(alice, "round-result", 20_000);
    const spectator = waitForMoveRejection(alice, 5);
    move(alice, 5, 1, 0, -1);
    expect((await spectator).reason).toBe("not-moving");
  });

  it("keeps the round moving and lets a player reconnect without deadlocking", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitForPhase(alice, "racing");
    // Colyseus only allows automatic reconnection after the room has been up
    // for at least five seconds; wait past that before dropping Bob.
    await new Promise((resolve) => setTimeout(resolve, 5_200));
    const bobSessionId = bob.sessionId;

    bob.connection.close();
    await waitFor(
      () => alice.state.players.get(bobSessionId)?.connectionStatus === "reconnecting",
      10_000,
    );

    await waitForPhase(alice, "round-result", 20_000);
    await waitForPhase(alice, "preparing");

    await waitFor(
      () => alice.state.players.get(bobSessionId)?.connectionStatus === "connected",
      15_000,
    );
    await waitForPhase(alice, "preview");
    await waitForPhase(alice, "racing");
    await waitForPhase(bob, "racing");
    const mover = makeMover();
    await driveToFinish(bob, 2, bob.sessionId, mover);
    await waitForPhase(alice, "round-result");
    await waitFor(
      () => [...(alice.state.roundResult?.winnerSessionIds ?? [])].join("|") === bobSessionId,
    );
  }, 90_000);

  it("rejects play again when a permanent departure leaves fewer than two players", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const mover = makeMover();

    for (
      let roundNumber = 1;
      roundNumber <= MEMORY_PATH_CONSTANTS.NORMAL_ROUNDS;
      roundNumber += 1
    ) {
      await waitForPhase(alice, "racing");
      await driveToFinish(alice, roundNumber, alice.sessionId, mover);
      if (roundNumber < MEMORY_PATH_CONSTANTS.NORMAL_ROUNDS) {
        await waitForPhase(alice, "preparing");
      }
    }
    await waitForPhase(alice, "match-result", 15_000);

    await bob.leave();
    await waitFor(() => alice.state.players.size === 1, 5_000);
    const notEnoughPlayers = waitForRoomError(alice, "NOT_ENOUGH_PLAYERS");
    alice.send(ROOM_MESSAGE_TYPES.playAgain, {});
    await notEnoughPlayers;

    expect(alice.state.phase).toBe("match-result");
    expect(alice.state.matchResult).not.toBeNull();
  }, 90_000);

  it("rejects direct matchmaking creation without the server room token", async () => {
    await expect(
      matchMaker.create(MEMORY_PATH_ROOM_TYPE, {
        roomCode: "ABCDEF",
        players: playerIds(2),
      }),
    ).rejects.toThrow();
  });

  it("rejects late joins after the match has started", async () => {
    const { room, reservations } = await createDirectRoom(2);
    const alice = await consumeGame(test, reservations[0]);
    await consumeGame(test, reservations[1]);
    await waitForPhase(alice, "preparing");
    await expect(
      consumeGame(
        test,
        await matchMaker.joinById(room.roomId, {
          playerId: "00000000-0000-4000-8000-000000000099",
          playerName: "Late",
        }),
      ),
    ).rejects.toThrow();
  });
});
