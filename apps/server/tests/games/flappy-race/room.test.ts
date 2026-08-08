import { randomBytes } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import {
  FlappyRaceState,
  type ISeatReservation,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFlappyRaceGameDefinition,
  FLAPPY_RACE_ROOM_TYPE,
} from "../../../src/games/flappy-race/definition.js";
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

async function consumeLobby(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LobbyRoomState,
  );
}

async function consumeGame(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    FlappyRaceState,
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

function waitForFlapRejection(
  room: MessageRoom,
  sequence: number,
): Promise<{ sequence: number; roundNumber: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for flap rejection ${sequence}`)),
      5_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === "flap-rejected") {
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

function flap(room: SendRoom, sequence: number, roundNumber: number): void {
  room.send("game:flap", { type: "flap", sequence, roundNumber });
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
  const room = await matchMaker.create(FLAPPY_RACE_ROOM_TYPE, {
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

describe("Flappy Race room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createFlappyRaceGameDefinition(ROOM_CREATION_TOKEN)]),
      createTestConfig(E2E_CONFIG),
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs the full lobby-to-game transition, five-round match, and play-again flow", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "flappy-race" });
    await waitFor(() => aliceLobby.state.gameId === "flappy-race");

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
    expect(bobGame.state.phase).toBe("countdown");
    expect(aliceGame.state.roomCode).toBe(created.body.room.code);
    expect(aliceGame.state.gameId).toBe("flappy-race");
    expect(aliceGame.state.totalRounds).toBe(5);
    expect(aliceGame.state.courseSpeed).toBe(450);
    expect(aliceGame.state.countdownEndsAt).toBeGreaterThan(Date.now());
    expect(aliceGame.state.obstacleOpenings.length).toBeGreaterThan(0);
    expect(aliceGame.state.obstacleOpenings.length).toBe(bobGame.state.obstacleOpenings.length);
    expect("courseSeed" in aliceGame.state).toBe(false);

    // Flaps during the countdown move only the flapping bird; obstacles stay put.
    flap(aliceGame, 1, 1);
    await waitFor(() => {
      const aliceY = aliceGame.state.players.get(aliceGame.sessionId)?.birdY ?? 0;
      const bobY = bobGame.state.players.get(bobGame.sessionId)?.birdY ?? 0;
      return aliceY < bobY;
    });

    await waitFor(() => aliceGame.state.phase === "running", 10_000);
    await waitFor(() => aliceGame.state.phase === "round-result", 20_000);
    const roundOneWinners = [...aliceGame.state.roundWinnerSessionIds].sort();
    expect(roundOneWinners).toEqual([aliceGame.sessionId, bobGame.sessionId].sort());
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.roundWins).toBe(1);
    expect(aliceGame.state.players.get(bobGame.sessionId)?.roundWins).toBe(1);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.clearedObstacleCount).toBe(1);
    expect(aliceGame.state.players.get(bobGame.sessionId)?.clearedObstacleCount).toBe(1);

    // Round 2: Alice flaps up and crashes at obstacle 1; Bob passes it and wins.
    await waitFor(
      () => aliceGame.state.phase === "countdown" && aliceGame.state.roundNumber === 2,
      10_000,
    );
    for (let index = 0; index < 12; index++) {
      flap(aliceGame, 100 + index, 2);
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    await waitFor(() => aliceGame.state.phase === "round-result", 15_000);
    expect([...aliceGame.state.roundWinnerSessionIds]).toEqual([bobGame.sessionId]);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.roundWins).toBe(1);
    expect(aliceGame.state.players.get(bobGame.sessionId)?.roundWins).toBe(2);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.clearedObstacleCount).toBe(0);
    expect(aliceGame.state.players.get(bobGame.sessionId)?.clearedObstacleCount).toBe(1);

    // Rounds 3-4 draw; round 5 goes straight to the final board.
    for (let round = 3; round <= 4; round++) {
      await waitFor(
        () => aliceGame.state.phase === "round-result" && aliceGame.state.roundNumber === round,
        20_000,
      );
    }
    await waitFor(
      () => aliceGame.state.phase === "countdown" && aliceGame.state.roundNumber === 5,
      10_000,
    );
    await waitFor(() => aliceGame.state.phase === "finished", 20_000);
    expect(aliceGame.state.roundNumber).toBe(5);
    const result = aliceGame.state.result;
    if (result === null) {
      throw new Error("Expected a match result");
    }
    expect([...result.winnerSessionIds]).toEqual([bobGame.sessionId]);
    const leaderboard = [...result.leaderboard];
    const aliceEntry = leaderboard.find((entry) => entry.sessionId === aliceGame.sessionId);
    const bobEntry = leaderboard.find((entry) => entry.sessionId === bobGame.sessionId);
    expect(aliceEntry?.primaryScore).toBe(4);
    expect(bobEntry?.primaryScore).toBe(5);
    expect(aliceEntry?.rank).toBe(2);
    expect(bobEntry?.rank).toBe(1);

    const nonHostAgain = waitForRoomError(bobGame, "NOT_HOST");
    bobGame.send("play_again", {});
    await nonHostAgain;
    aliceGame.send("play_again", {});
    await waitFor(() => aliceGame.state.phase === "countdown");
    await waitFor(() => bobGame.state.phase === "countdown");
    await waitFor(() => bobGame.state.players.get(bobGame.sessionId)?.roundWins === 0);
    expect(aliceGame.state.roundNumber).toBe(1);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.roundWins).toBe(0);
  }, 90_000);

  it("rejects invalid, stale, and spectator flaps and never trusts client positions", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "running", 10_000);

    const invalidCommand = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:flap", { command: { type: "jump" } });
    await invalidCommand;

    const cheat = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:flap", {
      type: "flap",
      sequence: 2,
      roundNumber: 1,
      birdY: 999,
      vy: -999,
      winner: true,
    });
    await cheat;

    const oldRound = waitForFlapRejection(alice, 3);
    flap(alice, 3, 99);
    expect((await oldRound).reason).toBe("old-round");

    flap(alice, 4, 1);
    const stale = waitForFlapRejection(alice, 4);
    flap(alice, 4, 1);
    expect((await stale).reason).toBe("stale-sequence");

    // Wait for the round to end, then a spectator flap is rejected as not-running.
    await waitFor(() => alice.state.phase === "round-result", 20_000);
    const spectator = waitForFlapRejection(alice, 5);
    flap(alice, 5, 1);
    expect((await spectator).reason).toBe("not-running");
  });

  it("removes disconnected players from the round and lets reconnects spectate", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "countdown");
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
    await waitFor(() => alice.state.phase === "round-result", 15_000);
    expect([...alice.state.roundWinnerSessionIds]).toEqual([alice.sessionId]);

    const reconnected = await test.testServer.sdk.reconnect(bobToken);
    expect(reconnected.sessionId).toBe(bobSessionId);
    await waitFor(
      () => alice.state.players.get(bobSessionId)?.connectionStatus === "connected",
      10_000,
    );
    await waitFor(() => alice.state.phase === "countdown" && alice.state.roundNumber === 2, 15_000);
    expect(alice.state.players.get(bobSessionId)?.roundActive).toBe(false);
    expect(alice.state.players.get(bobSessionId)?.matchRemoved).toBe(true);
    expect(alice.state.players.get(alice.sessionId)?.roundActive).toBe(true);

    await waitFor(() => alice.state.phase === "finished", 45_000);
    const result = alice.state.result;
    if (result === null) {
      throw new Error("Expected a match result");
    }
    expect([...result.winnerSessionIds]).toEqual([alice.sessionId]);
    const aliceEntry = [...result.leaderboard].find((entry) => entry.sessionId === alice.sessionId);
    expect(aliceEntry?.primaryScore).toBe(5);
  });

  it("returns to the lobby when every player disconnects mid-match", async () => {
    const { room, reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "countdown");

    alice.connection.close();
    bob.connection.close();
    await waitFor(() => {
      const localRoom = matchMaker.getLocalRoomById(room.roomId) as
        | { state: FlappyRaceState }
        | undefined;
      return (
        localRoom === undefined ||
        localRoom.state.phase === "lobby" ||
        localRoom.state.players.size === 0
      );
    }, 15_000);
  });

  it("disposes the game room when a roster player never arrives", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "flappy-race" });
    await waitFor(() => aliceLobby.state.gameId === "flappy-race");

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
      matchMaker.create(FLAPPY_RACE_ROOM_TYPE, {
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
    expect(alice.state.phase).toBe("lobby");
    expect(alice.state.hostSessionId).toBe(alice.sessionId);

    await alice.leave();
    await waitFor(() => bob.state.players.size === 1);
    expect(bob.state.hostSessionId).toBe(bob.sessionId);

    const carol = await consumeGame(test, reservations[2]);
    await waitFor(() => bob.state.players.size === 2);
    await waitFor(() => bob.state.phase === "countdown");
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
    expect(bob.state.players.get(alice.sessionId)?.roundActive).toBe(true);
    expect(carol.state.phase).toBe("countdown");
  });
});
