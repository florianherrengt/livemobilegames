import { randomBytes } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import {
  GolfRaceState,
  type ISeatReservation,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameRegistry } from "../../../src/games/game-registry.js";
import {
  createGolfRaceGameDefinition,
  GOLF_ROOM_TYPE,
} from "../../../src/games/golf-race/definition.js";
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

type GameRoomHandle = {
  sessionId: string;
  state: GolfRaceState;
  send: SendRoom["send"];
};

async function consumeLobby(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LobbyRoomState,
  );
}

async function consumeGame(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(reservation as ISeatReservation, GolfRaceState);
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

function waitForShotRejection(
  room: MessageRoom,
  sequence: number,
): Promise<{ sequence: number; roundNumber: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for shot rejection ${sequence}`)),
      5_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === "shot-rejected") {
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

function shot(
  room: SendRoom,
  sequence: number,
  roundNumber: number,
  aimX: number,
  aimY: number,
): void {
  room.send("game:shot", { type: "shot", sequence, roundNumber, aimX, aimY });
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
  const room = await matchMaker.create(GOLF_ROOM_TYPE, {
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

/**
 * Drives a deterministic match from real clients: whenever one client sees an
 * aiming turn, that client sends a shot aimed up with a small correction
 * toward the route centre. Every result is read from each client's own
 * synchronized state.
 */
async function playDeterministicMatch(rooms: GameRoomHandle[], timeoutMs = 90_000): Promise<void> {
  const sequences = new Map<string, number>();
  const startedAt = Date.now();
  await waitFor(() => rooms.some((room) => room.state.phase !== "lobby"), 15_000);
  while (
    !rooms.every((room) => room.state.phase === "finished") &&
    Date.now() - startedAt < timeoutMs
  ) {
    const reference = rooms[0];
    if (reference?.state.phase !== "aiming") {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    const activeSessionId = reference.state.currentTurnSessionId;
    const activeRoom = rooms.find((room) => room.sessionId === activeSessionId);
    if (!activeRoom) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    const player = activeRoom.state.players.get(activeSessionId);
    if (!player || player.finished) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    const correction = Math.max(-0.6, Math.min(0.6, (600 - player.positionX) / 800));
    const aimX = -correction * 220;
    const aimY = Math.sqrt(220 * 220 - aimX * aimX);
    const sequence = (sequences.get(activeSessionId) ?? 0) + 1;
    sequences.set(activeSessionId, sequence);
    shot(activeRoom as SendRoom, sequence, activeRoom.state.roundNumber, aimX, aimY);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  if (!rooms.every((room) => room.state.phase === "finished")) {
    throw new Error("Deterministic match did not finish in time");
  }
}

function assertConsistentState(rooms: GameRoomHandle[]): void {
  const reference = rooms[0];
  if (!reference) {
    throw new Error("missing reference room");
  }
  for (const room of rooms) {
    expect(room.state.phase).toBe(reference.state.phase);
    expect([...room.state.players.keys()].sort()).toEqual(
      [...reference.state.players.keys()].sort(),
    );
    for (const [sessionId, player] of reference.state.players) {
      const other = room.state.players.get(sessionId);
      if (!other) {
        throw new Error(`missing player ${sessionId}`);
      }
      expect(other.positionX).toBeCloseTo(player.positionX, 3);
      expect(other.positionY).toBeCloseTo(player.positionY, 3);
      expect(other.latestGateIndex).toBe(player.latestGateIndex);
      expect(other.finishedRank).toBe(player.finishedRank);
      expect(other.raceProgress).toBeCloseTo(player.raceProgress, 3);
    }
  }
}

describe("Golf room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createGolfRaceGameDefinition(ROOM_CREATION_TOKEN)]),
      createTestConfig(E2E_CONFIG),
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs the full lobby-to-game transition, a complete match, and play again", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "golf" });
    await waitFor(() => aliceLobby.state.gameId === "golf");

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
    await waitFor(() => aliceGame.state.phase === "countdown");
    expect(aliceGame.state.roomCode).toBe(created.body.room.code);
    expect(aliceGame.state.gameId).toBe("golf");
    expect(aliceGame.state.roundNumber).toBe(1);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.positionY).toBe(1690);
    expect(bobGame.state.players.get(bobGame.sessionId)?.positionY).toBe(1690);

    // A third player cannot join a locked running game room.
    const notJoinable = await joinRoomHttp(test, created.body.room.code, "Carol");
    expect(notJoinable.response.status).toBe(409);
    expect(notJoinable.body.error?.code).toBe("ROOM_NOT_JOINABLE");

    const rooms = [
      {
        sessionId: aliceGame.sessionId,
        state: aliceGame.state,
        send: aliceGame.send.bind(aliceGame),
      },
      {
        sessionId: bobGame.sessionId,
        state: bobGame.state,
        send: bobGame.send.bind(bobGame),
      },
    ];
    await playDeterministicMatch(rooms, 240_000);

    const aliceResult = aliceGame.state.result;
    const bobResult = bobGame.state.result;
    if (aliceResult === null || bobResult === null) {
      throw new Error("Expected results on both clients");
    }
    expect([...aliceResult.winnerSessionIds]).toEqual([...bobResult.winnerSessionIds]);
    expect(aliceResult.leaderboard.length).toBe(2);
    expect(bobResult.leaderboard.length).toBe(2);
    expect([...aliceResult.leaderboard].map((entry) => entry.label)).toEqual(
      [...bobResult.leaderboard].map((entry) => entry.label),
    );
    assertConsistentState(rooms);
    expect(aliceGame.state.finishedCount).toBe(2);
    expect(bobGame.state.finishedCount).toBe(2);

    const nonHostAgain = waitForRoomError(bobGame, "NOT_HOST");
    bobGame.send("play_again", {});
    await nonHostAgain;

    aliceGame.send("play_again", {});
    await waitFor(() => aliceGame.state.phase === "countdown", 10_000);
    await waitFor(() => bobGame.state.phase === "countdown", 10_000);
    expect(aliceGame.state.roundNumber).toBe(1);
    expect(aliceGame.state.result === null || aliceGame.state.result === undefined).toBe(true);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.finished).toBe(false);
  }, 300_000);

  it("rejects invalid, forged, stale, and spectator shots", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "aiming", 10_000);

    const invalidCommand = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:shot", { command: { type: "putt" } });
    await invalidCommand;

    const cheat = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:shot", {
      type: "shot",
      sequence: 2,
      roundNumber: 1,
      aimX: 0,
      aimY: 220,
      positionX: 999,
      velocityY: -999,
      winner: true,
    });
    await cheat;

    const notTurn = waitForShotRejection(bob, 3);
    bob.send("game:shot", {
      type: "shot",
      sequence: 3,
      roundNumber: 1,
      aimX: 0,
      aimY: 220,
    });
    expect((await notTurn).reason).toBe("not-your-turn");

    const belowMinimum = waitForShotRejection(alice, 4);
    alice.send("game:shot", {
      type: "shot",
      sequence: 4,
      roundNumber: 1,
      aimX: 0,
      aimY: 10,
    });
    expect((await belowMinimum).reason).toBe("below-minimum-power");

    const oldRound = waitForShotRejection(alice, 5);
    alice.send("game:shot", {
      type: "shot",
      sequence: 5,
      roundNumber: 99,
      aimX: 0,
      aimY: 220,
    });
    expect((await oldRound).reason).toBe("old-round");

    shot(alice, 6, 1, 0, 220);
    await waitFor(() => alice.state.phase === "simulating");
    const duringSimulation = waitForShotRejection(alice, 7);
    alice.send("game:shot", {
      type: "shot",
      sequence: 7,
      roundNumber: 1,
      aimX: 0,
      aimY: 220,
    });
    expect((await duringSimulation).reason).toBe("not-aiming");
  });

  it("resolves simultaneous shot submissions in favour of the active player", async () => {
    const { reservations } = await createDirectRoom(2);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "aiming", 10_000);

    const bobRejection = waitForShotRejection(bob, 1);
    bob.send("game:shot", {
      type: "shot",
      sequence: 1,
      roundNumber: alice.state.roundNumber,
      aimX: 0,
      aimY: 220,
    });
    alice.send("game:shot", {
      type: "shot",
      sequence: 1,
      roundNumber: alice.state.roundNumber,
      aimX: 0,
      aimY: 220,
    });

    expect((await bobRejection).reason).toBe("not-your-turn");
    await waitFor(() => alice.state.phase === "simulating", 5_000);
    await waitFor(() => bob.state.phase === "simulating", 5_000);
  });

  it("runs an eight-player match from start to consistent results", async () => {
    const { reservations } = await createDirectRoom(8);
    const rooms: GameRoomHandle[] = [];
    for (const reservation of reservations) {
      const room = await consumeGame(test, reservation);
      rooms.push({
        sessionId: room.sessionId,
        state: room.state,
        send: room.send.bind(room),
      });
    }
    await waitFor(() => rooms[0]?.state.players.size === 8, 15_000);
    await waitFor(() => rooms[0]?.state.phase === "countdown", 15_000);

    await playDeterministicMatch(rooms, 300_000);

    const reference = rooms[0];
    if (!reference) {
      throw new Error("missing reference room");
    }
    const result = reference.state.result;
    if (result === null) {
      throw new Error("missing result");
    }
    expect(result.leaderboard.length).toBe(8);
    for (const room of rooms) {
      expect(room.state.phase).toBe("finished");
      expect(room.state.result?.leaderboard.length).toBe(8);
      expect([...(room.state.result?.winnerSessionIds ?? [])]).toEqual([
        ...result.winnerSessionIds,
      ]);
    }
    assertConsistentState(rooms);
  }, 360_000);

  it("keeps a finished player in the recorded result after they leave", async () => {
    const { reservations } = await createDirectRoom(2);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const rooms: GameRoomHandle[] = [
      { sessionId: alice.sessionId, state: alice.state, send: alice.send.bind(alice) },
      { sessionId: bob.sessionId, state: bob.state, send: bob.send.bind(bob) },
    ];
    await playDeterministicMatch(rooms, 180_000);
    expect(alice.state.phase).toBe("finished");
    const bobSessionId = bob.sessionId;

    await bob.leave();
    await waitFor(
      () => alice.state.players.get(bobSessionId)?.connectionStatus === "disconnected",
      10_000,
    );
    expect(alice.state.players.has(bobSessionId)).toBe(true);
    const result = alice.state.result;
    if (result === null) {
      throw new Error("missing result");
    }
    expect(result.leaderboard.length).toBe(2);
    expect([...result.leaderboard].some((entry) => entry.sessionId === bobSessionId)).toBe(true);

    alice.send("play_again", {});
    await waitFor(() => alice.state.phase === "lobby", 10_000);
    expect(alice.state.players.has(bobSessionId)).toBe(false);
    expect(alice.state.players.size).toBe(1);
  }, 240_000);

  it("does not deadlock when a player disconnects and reconnects", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await waitFor(() => alice.state.players.size === 3);
    await waitFor(() => alice.state.phase === "aiming", 10_000);

    const bobSessionId = bob.sessionId;
    const bobToken = bob.reconnectionToken;
    if (bobToken === undefined) {
      throw new Error("Expected Bob's reconnection token");
    }
    bob.connection.close();
    await waitFor(
      () => alice.state.players.get(bobSessionId)?.connectionStatus === "reconnecting",
      10_000,
    );

    // The match must keep advancing while Bob is in grace.
    const rooms = [
      { sessionId: alice.sessionId, state: alice.state, send: alice.send.bind(alice) },
      { sessionId: carol.sessionId, state: carol.state, send: carol.send.bind(carol) },
    ];
    const progressPromise = playDeterministicMatch(rooms, 180_000);

    const reconnectedRoom = await test.testServer.sdk.reconnect(bobToken);
    expect(reconnectedRoom.sessionId).toBe(bobSessionId);
    await waitFor(
      () => alice.state.players.get(bobSessionId)?.connectionStatus === "connected",
      10_000,
    );
    rooms.push({
      sessionId: reconnectedRoom.sessionId,
      state: reconnectedRoom.state,
      send: reconnectedRoom.send.bind(reconnectedRoom),
    });
    await progressPromise;
    expect(alice.state.phase).toBe("finished");
    expect(alice.state.players.size).toBe(3);
  }, 240_000);

  it("keeps the match alive when a player permanently leaves", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await waitFor(() => alice.state.players.size === 3);

    bob.leave();
    await waitFor(() => alice.state.players.size === 2);

    const rooms = [
      { sessionId: alice.sessionId, state: alice.state, send: alice.send.bind(alice) },
      { sessionId: carol.sessionId, state: carol.state, send: carol.send.bind(carol) },
    ];
    await playDeterministicMatch(rooms, 180_000);
    expect(alice.state.phase).toBe("finished");
    expect(alice.state.result?.leaderboard.length).toBe(2);
  }, 240_000);

  it("disposes the game room when a roster player never arrives", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "golf" });
    await waitFor(() => aliceLobby.state.gameId === "golf");

    const aliceTransition = waitForTransition(aliceLobby);
    aliceLobby.send("start_game", {});
    const payload = await aliceTransition;
    await consumeGame(test, payload.reservation);

    await waitFor(
      () => test.platform.roomDirectory.getByCode(created.body.room.code) === undefined,
      5_000,
    );
  });

  it("rejects direct matchmaking creation without the server room token", async () => {
    await expect(
      matchMaker.create(GOLF_ROOM_TYPE, {
        roomCode: "ABCDEF",
        players: playerIds(2),
      }),
    ).rejects.toThrow();
  });

  it("keeps remaining players and transfers host when someone leaves the pre-game lobby", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.players.size === 2);
    expect(alice.state.hostSessionId).toBe(alice.sessionId);

    await alice.leave();
    await waitFor(() => bob.state.players.size === 1);
    expect(bob.state.hostSessionId).toBe(bob.sessionId);

    const carol = await consumeGame(test, reservations[2]);
    await waitFor(() => bob.state.players.size === 2);
    await waitFor(() => bob.state.phase === "countdown", 10_000);
    expect(carol.state.phase).toBe("countdown");
  });

  it("does not start while a roster player is in reconnection grace", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.players.size === 2);
    expect(alice.state.phase).toBe("lobby");

    const aliceToken = alice.reconnectionToken;
    if (aliceToken === undefined) {
      throw new Error("Expected Alice's reconnection token");
    }
    alice.connection.close();
    await waitFor(
      () => bob.state.players.get(alice.sessionId)?.connectionStatus === "reconnecting",
      10_000,
    );

    const carol = await consumeGame(test, reservations[2]);
    await waitFor(() => bob.state.players.size === 3);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(bob.state.phase).toBe("lobby");

    const reconnected = await test.testServer.sdk.reconnect(aliceToken);
    expect(reconnected.sessionId).toBe(alice.sessionId);
    await waitFor(() => bob.state.phase === "countdown", 10_000);
    expect(carol.state.phase).toBe("countdown");
  });
});
