import { randomBytes } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import {
  CapitalPinState,
  type ISeatReservation,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CAPITAL_PIN_ROOM_TYPE,
  createCapitalPinGameDefinition,
} from "../../../src/games/capital-pin/definition.js";
import { createGameRegistry } from "../../../src/games/game-registry.js";
import {
  cookieValue,
  createTestConfig,
  createTestPlatform,
  expectDefined,
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

async function consumeLobby(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LobbyRoomState,
  );
}

async function consumeGame(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    CapitalPinState,
  );
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

function submit(room: SendRoom, roundNumber: number, latitude: number, longitude: number): void {
  room.send("game:submit", { type: "submit", roundNumber, latitude, longitude });
}

describe("Capital Pin room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createCapitalPinGameDefinition(ROOM_CREATION_TOKEN)]),
      createTestConfig(E2E_CONFIG),
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs the full lobby-to-game transition, rounds, finish and play-again flow", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "capital-pin" });
    await waitFor(() => aliceLobby.state.gameId === "capital-pin");

    // Non-host cannot start the transition.
    const bobStartError = waitForRoomError(bobLobby, "NOT_HOST");
    bobLobby.send("start_game", {});
    await bobStartError;

    const aliceTransition = waitForTransition(aliceLobby);
    const bobTransition = waitForTransition(bobLobby);
    aliceLobby.send("start_game", {});

    const [alicePayload, bobPayload] = await Promise.all([aliceTransition, bobTransition]);
    const aliceGame = await consumeGame(test, alicePayload.reservation);
    await waitFor(() => aliceGame.state.players.size === 1);
    expect(aliceGame.state.phase).toBe("lobby");
    expect(aliceGame.state.roomCode).toBe(created.body.room.code);
    expect(aliceGame.state.gameId).toBe("capital-pin");
    expect(aliceGame.state.hostSessionId).toBe(aliceGame.sessionId);

    // Guesses before the full roster arrives (pre-start lobby) are rejected.
    const earlyError = waitForRoomError(aliceGame, "GAME_NOT_RUNNING");
    submit(aliceGame, 1, 0, 0);
    await earlyError;

    // The last roster player arriving auto-starts round 1: one start click in
    // the platform lobby is enough, there is no second manual start.
    const bobGame = await consumeGame(test, bobPayload.reservation);
    await waitFor(() => aliceGame.state.players.size === 2);
    await waitFor(() => aliceGame.state.phase === "round");
    expect(bobGame.state.phase).toBe("round");

    // Secret-data guarantee: only the capital name is visible during a round.
    expect(aliceGame.state.currentCapitalName).not.toBe("");
    expect(aliceGame.state.lastResult).toBeNull();
    expect(aliceGame.state.totalRounds).toBe(10);
    expect(aliceGame.state.roundNumber).toBe(1);

    // A third player cannot join a room whose game has started.
    const notJoinable = await joinRoomHttp(test, created.body.room.code, "Charlie");
    expect(notJoinable.response.status).toBe(409);
    expect(notJoinable.body.error?.code).toBe("ROOM_NOT_JOINABLE");
    expect(test.platform.roomDirectory.getByCode(created.body.room.code)).toBeDefined();

    const roundNumber = aliceGame.state.roundNumber;
    submit(aliceGame, roundNumber, 48.85, 2.35);
    await waitFor(() => aliceGame.state.players.get(aliceGame.sessionId)?.submitted === true);

    // A second submit is rejected without changing state.
    const doubleSubmit = waitForRoomError(aliceGame, "INVALID_GAME_COMMAND");
    submit(aliceGame, roundNumber, 0, 0);
    await doubleSubmit;

    submit(bobGame, roundNumber, 40, 0);
    await waitFor(() => aliceGame.state.phase === "round-results");
    const result = aliceGame.state.lastResult;
    expect(result?.roundNumber).toBe(1);
    expect(result?.guesses.length).toBe(2);
    expect(result?.winnerSessionIds.length).toBeGreaterThan(0);

    // The e2e results timer advances into round 2.
    await waitFor(() => aliceGame.state.phase === "round");
    expect(aliceGame.state.roundNumber).toBe(2);

    // Play the remaining rounds by early finish.
    for (let round = 2; round <= 10; round++) {
      const currentRound = aliceGame.state.roundNumber;
      expect(currentRound).toBe(round);
      submit(aliceGame, currentRound, 48.85, 2.35);
      submit(bobGame, currentRound, 40, 0);
      await waitFor(() => aliceGame.state.phase === "round-results");
      if (round < 10) {
        await waitFor(() => aliceGame.state.phase === "round");
      }
    }

    await waitFor(() => aliceGame.state.phase === "finished");
    expect(aliceGame.state.result?.leaderboard).toHaveLength(2);

    // Only the host can play again; the reset clears scores and submitted.
    const nonHostAgain = waitForRoomError(bobGame, "NOT_HOST");
    bobGame.send("play_again", {});
    await nonHostAgain;

    // A rematch must wait while a roster player is reconnecting. The match is
    // old enough for Colyseus reconnection by the time ten rounds complete.
    bobGame.reconnection.enabled = false;
    bobGame.connection.close();
    await waitFor(
      () => aliceGame.state.players.get(bobGame.sessionId)?.connectionStatus === "reconnecting",
    ).catch(() => {
      throw new Error("Bob never entered reconnecting state");
    });
    await waitFor(() => bobGame.reconnectionToken !== undefined).catch(() => {
      throw new Error("Bob never received a reconnection token");
    });

    let hostPlayAgainError: { code: string; message: string } | null = null;
    const offHostError = aliceGame.onMessage("*", (type, payload) => {
      if (type === ROOM_MESSAGE_TYPES.error) {
        hostPlayAgainError = payload as { code: string; message: string };
      }
    });
    aliceGame.send("play_again", {});
    await waitFor(
      () =>
        aliceGame.state.result === null ||
        aliceGame.state.result === undefined ||
        hostPlayAgainError !== null,
    );
    offHostError();
    expect(hostPlayAgainError).toBeNull();
    expect(aliceGame.state.phase).toBe("lobby");
    expect(aliceGame.state.roundNumber).toBe(0);

    const token = bobGame.reconnectionToken;
    if (token === undefined) {
      throw new Error("Missing Bob reconnection token");
    }
    const reconnectedBob = await test.testServer.sdk.reconnect(token, CapitalPinState);
    // Once everyone is connected again, play-again auto-starts round 1.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reconnectedBob.state.players.size).toBe(2);
    expect(aliceGame.state.players.size).toBe(2);
    expect(
      [...reconnectedBob.state.players.entries()].map(([sessionId, player]) => ({
        sessionId,
        connectionStatus: player.connectionStatus,
      })),
    ).toEqual([
      { sessionId: aliceGame.sessionId, connectionStatus: "connected" },
      { sessionId: bobGame.sessionId, connectionStatus: "connected" },
    ]);
    expect(reconnectedBob.state.phase).toBe("round");
    expect(aliceGame.state.phase).toBe("round");
    expect(aliceGame.state.roundNumber).toBe(1);
    expect(aliceGame.state.result ?? null).toBeNull();
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.roundWins).toBe(0);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.submitted).toBe(false);
  });

  it("disposes the game room when a roster player never arrives", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "capital-pin" });
    await waitFor(() => aliceLobby.state.gameId === "capital-pin");

    const aliceTransition = waitForTransition(aliceLobby);
    aliceLobby.send("start_game", {});
    const payload = await aliceTransition;
    await consumeGame(test, payload.reservation);

    // Bob never consumes his reservation; the game room disposes itself and
    // the code mapping is released (the 500ms test timeout is configured).
    await waitFor(
      () => test.platform.roomDirectory.getByCode(created.body.room.code) === undefined,
      5_000,
    );
  });

  it("rejects starting the transition with fewer than the minimum players", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    aliceLobby.send("select_game", { gameId: "capital-pin" });
    await waitFor(() => aliceLobby.state.gameId === "capital-pin");

    const notEnough = waitForRoomError(aliceLobby, "NOT_ENOUGH_PLAYERS");
    aliceLobby.send("start_game", {});
    await notEnough;

    // The failed start leaves the lobby and its code mapping untouched.
    expect(test.platform.roomDirectory.getByCode(created.body.room.code)).toBeDefined();
    expect(aliceLobby.state.roomCode).toBe(created.body.room.code);
  });

  it("rejects a seat for a player who is not on the trusted roster", async () => {
    const room = await matchMaker.create(CAPITAL_PIN_ROOM_TYPE, {
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
    const localRoom = expectDefined(matchMaker.getLocalRoomById(room.roomId)) as unknown as {
      state: CapitalPinState;
    };
    await expect(
      test.testServer.sdk.joinById(room.roomId, {
        playerId: "33333333-3333-4333-8333-333333333333",
        playerName: "Carol",
      }),
    ).rejects.toThrow();
    expect(localRoom.state.players.size).toBe(0);
  });

  it("starts an eight-player roster from the platform transition", async () => {
    const players = Array.from({ length: 8 }, (_, index) => ({
      playerId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      playerName: `Player ${index}`,
      isHost: index === 0,
      joinedOrder: index,
    }));
    const room = await matchMaker.create(CAPITAL_PIN_ROOM_TYPE, {
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
    await waitFor(() => hostRoom.state.players.size === 8);
    await waitFor(() => hostRoom.state.phase === "round");
    expect(hostRoom.state.roundNumber).toBe(1);
    expect(hostRoom.state.players.size).toBe(8);
  });

  it("keeps the remaining players when someone leaves the pre-game lobby", async () => {
    const room = await matchMaker.create(CAPITAL_PIN_ROOM_TYPE, {
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
        {
          playerId: "33333333-3333-4333-8333-333333333333",
          playerName: "Carol",
          isHost: false,
          joinedOrder: 2,
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
    await waitFor(() => aliceGame.state.players.size === 1);
    const bobGame = await consumeGame(test, bobReservation);
    await waitFor(() => aliceGame.state.players.size === 2);
    expect(aliceGame.state.phase).toBe("lobby");

    await aliceGame.leave();
    await waitFor(() => bobGame.state.players.size === 1);
    expect(bobGame.state.phase).toBe("lobby");
    expect(bobGame.state.players.size).toBe(1);
    expect([...bobGame.state.players.values()][0]?.name).toBe("Bob");
  });

  it("rejects direct matchmaking creation without the server room token", async () => {
    await expect(
      matchMaker.create(CAPITAL_PIN_ROOM_TYPE, {
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
