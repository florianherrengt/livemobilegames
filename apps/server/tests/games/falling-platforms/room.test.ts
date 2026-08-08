import { randomBytes } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import {
  FallingPlatformsState,
  type ISeatReservation,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFallingPlatformsGameDefinition,
  FALLING_PLATFORMS_ROOM_TYPE,
} from "../../../src/games/falling-platforms/definition.js";
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
    FallingPlatformsState,
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

function waitForHopRejection(
  room: MessageRoom,
  sequence: number,
): Promise<{ sequence: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for hop rejection ${sequence}`)),
      5_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === "hop-rejected") {
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

function hop(room: SendRoom, sequence: number, targetPlatformId: string): void {
  room.send("game:hop", { type: "hop", sequence, targetPlatformId });
}

describe("Falling Platforms room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createFallingPlatformsGameDefinition(ROOM_CREATION_TOKEN)]),
      createTestConfig(E2E_CONFIG),
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs the full lobby-to-game transition, deterministic round, results, and play-again flow", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "falling-platforms" });
    await waitFor(() => aliceLobby.state.gameId === "falling-platforms");

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
    expect(aliceGame.state.gameId).toBe("falling-platforms");
    expect(aliceGame.state.hostSessionId).toBe(aliceGame.sessionId);
    expect(test.platform.roomDirectory.getByCode(created.body.room.code)?.gameId).toBe(
      "falling-platforms",
    );

    // Hops before the full roster arrives (pre-start lobby) are rejected.
    const earlyRejection = waitForHopRejection(aliceGame, 1);
    hop(aliceGame, 1, "3:4");
    expect((await earlyRejection).reason).toBe("not-playing");

    // The last roster player arriving auto-starts round 1: one start click in
    // the platform lobby is enough, there is no second manual start.
    const bobGame = await consumeGame(test, bobPayload.reservation);
    await waitFor(() => aliceGame.state.players.size === 2);
    await waitFor(() => aliceGame.state.phase === "countdown");
    await waitFor(() => aliceGame.state.phase === "playing");
    expect(bobGame.state.phase).toBe("playing");

    const aliceSession = aliceGame.sessionId;
    const bobSession = bobGame.sessionId;
    expect(aliceGame.state.players.get(aliceSession)?.currentPlatformId).toBe("3:3");
    expect(aliceGame.state.players.get(bobSession)?.currentPlatformId).toBe("3:4");
    expect(aliceGame.state.arenaSide).toBe(5);
    expect(aliceGame.state.aliveCount).toBe(2);

    // A third player cannot join a room whose game has started.
    const notJoinable = await joinRoomHttp(test, created.body.room.code, "Charlie");
    expect(notJoinable.response.status).toBe(409);
    expect(notJoinable.body.error?.code).toBe("ROOM_NOT_JOINABLE");
    expect(test.platform.roomDirectory.getByCode(created.body.room.code)).toBeDefined();

    // Claimed outcomes and extra fields are rejected at the schema boundary.
    const malformed = waitForRoomError(aliceGame, "INVALID_GAME_COMMAND");
    aliceGame.send("game:hop", {
      type: "hop",
      sequence: 2,
      targetPlatformId: "3:4",
      landed: true,
      winner: true,
    });
    await malformed;

    const invalidRejection = waitForHopRejection(aliceGame, 2);
    hop(aliceGame, 2, "9:9");
    expect((await invalidRejection).reason).toBe("invalid-target");

    // Alice hops from 3:3 to 4:3; both phones observe the authoritative jump.
    hop(aliceGame, 3, "4:3");
    await waitFor(() => aliceGame.state.players.get(aliceSession)?.jumping === true);
    await waitFor(
      () => aliceGame.state.players.get(aliceSession)?.currentPlatformId === "4:3",
      5_000,
    );
    await waitFor(() => bobGame.state.players.get(aliceSession)?.currentPlatformId === "4:3");

    // Duplicate/stale sequences are rejected without changing state.
    const staleRejection = waitForHopRejection(aliceGame, 3);
    hop(aliceGame, 3, "4:4");
    expect((await staleRejection).reason).toBe("stale-sequence");

    // Bob's spawn is the deterministic first warning target; he stands still,
    // his platform collapses and he is eliminated into spectating.
    await waitFor(() => aliceGame.state.platforms.get("3:4")?.state === "warning");
    await waitFor(() => bobGame.state.platforms.get("3:4")?.state === "warning");
    await waitFor(() => bobGame.state.players.get(bobSession)?.alive === false, 5_000);
    await waitFor(() => aliceGame.state.aliveCount === 1);
    await waitFor(() => aliceGame.state.phase === "results");
    expect(aliceGame.state.winnerSessionId).toBe(aliceSession);
    expect(aliceGame.state.draw).toBe(false);

    // A spectator cannot hop once the match has ended.
    const spectatorRejection = waitForHopRejection(bobGame, 1);
    hop(bobGame, 1, "4:4");
    expect((await spectatorRejection).reason).toBe("not-playing");

    // Both phones return to the same game-room lobby after the results.
    await waitFor(() => aliceGame.state.phase === "lobby", 10_000);
    await waitFor(() => bobGame.state.phase === "lobby");
    expect(aliceGame.state.platforms.size).toBe(0);
    expect(aliceGame.state.roundNumber).toBe(1);

    // Only the host can play again; the reset starts round 1 of a fresh match.
    const nonHostAgain = waitForRoomError(bobGame, "NOT_HOST");
    bobGame.send("play_again", {});
    await nonHostAgain;

    // A rematch must not start while a roster player is inside the reconnect
    // grace window. Preserve the completed room until that player returns.
    bobGame.reconnection.enabled = false;
    bobGame.connection.close();
    await waitFor(() => aliceGame.state.players.get(bobGame.sessionId)?.connected === false);
    await waitFor(() => bobGame.reconnectionToken !== undefined);

    aliceGame.send("play_again", {});
    await waitFor(() => aliceGame.state.roundNumber === 0);
    expect(aliceGame.state.phase).toBe("lobby");
    expect(aliceGame.state.platforms.size).toBe(0);

    const token = bobGame.reconnectionToken;
    if (token === undefined) {
      throw new Error("Missing Bob reconnection token");
    }
    const reconnectedBob = await test.testServer.sdk.reconnect(token, FallingPlatformsState);
    await waitFor(() => aliceGame.state.phase === "countdown");
    await waitFor(() => aliceGame.state.phase === "playing");
    expect(reconnectedBob.state.phase).toBe("playing");
    expect(aliceGame.state.roundNumber).toBe(1);
    expect(aliceGame.state.aliveCount).toBe(2);
    expect(aliceGame.state.platforms.size).toBe(25);
    expect(aliceGame.state.players.get(aliceSession)?.currentPlatformId).toBe("3:3");
    expect(aliceGame.state.players.get(bobSession)?.currentPlatformId).toBe("3:4");
  });

  it("disposes the game room when a roster player never arrives", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "falling-platforms" });
    await waitFor(() => aliceLobby.state.gameId === "falling-platforms");

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

    aliceLobby.send("select_game", { gameId: "falling-platforms" });
    await waitFor(() => aliceLobby.state.gameId === "falling-platforms");

    const notEnough = waitForRoomError(aliceLobby, "NOT_ENOUGH_PLAYERS");
    aliceLobby.send("start_game", {});
    await notEnough;

    expect(test.platform.roomDirectory.getByCode(created.body.room.code)).toBeDefined();
    expect(aliceLobby.state.roomCode).toBe(created.body.room.code);
  });

  it("rejects a seat for a player who is not on the trusted roster", async () => {
    const room = await matchMaker.create(FALLING_PLATFORMS_ROOM_TYPE, {
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
      state: FallingPlatformsState;
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
    const room = await matchMaker.create(FALLING_PLATFORMS_ROOM_TYPE, {
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
    await waitFor(() => hostRoom.state.phase === "playing");
    expect(hostRoom.state.roundNumber).toBe(1);
    expect(hostRoom.state.players.size).toBe(8);
    expect(hostRoom.state.aliveCount).toBe(8);
  });

  it("keeps remaining players and transfers host when someone leaves the pre-game lobby", async () => {
    const room = await matchMaker.create(FALLING_PLATFORMS_ROOM_TYPE, {
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
    expect(bobGame.state.hostSessionId).toBe(bobGame.sessionId);
  });

  it("recovers a dropped connection within the grace window", async () => {
    const room = await matchMaker.create(FALLING_PLATFORMS_ROOM_TYPE, {
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
    await waitFor(() => aliceGame.state.phase === "playing");
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.connected).toBe(true);

    // Drop Alice's socket: the server marks her disconnected and starts the
    // reconnection grace instead of removing her.
    aliceGame.connection.close();
    await waitFor(() => bobGame.state.players.get(aliceGame.sessionId)?.connected === false);
    await waitFor(() => aliceGame.reconnectionToken !== undefined);

    const token = aliceGame.reconnectionToken;
    expect(token).toBeDefined();
    const reconnected = await test.testServer.sdk.reconnect(token, FallingPlatformsState);
    await waitFor(() => bobGame.state.players.get(aliceGame.sessionId)?.connected === true);
    expect(reconnected.state.players.get(reconnected.sessionId)?.connected).toBe(true);

    // Server-driven patches resume: Alice can hop again after reconnecting.
    hop(reconnected, 1, "4:3");
    await waitFor(
      () => reconnected.state.players.get(reconnected.sessionId)?.currentPlatformId === "4:3",
      5_000,
    );
  });

  it("waits for every member of a three-player roster before starting a rematch", async () => {
    const players = [
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
    ];
    const room = await matchMaker.create(FALLING_PLATFORMS_ROOM_TYPE, {
      roomCode: "ABCDEF",
      players,
      e2eMode: true,
      transitionTimeoutMs: 5_000,
      roomCreationToken: ROOM_CREATION_TOKEN,
    });
    const reservations = await Promise.all(
      players.map((player) =>
        matchMaker.joinById(room.roomId, {
          playerId: player.playerId,
          playerName: player.playerName,
        }),
      ),
    );
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await waitFor(() => alice.state.phase === "playing");

    // Move Bob and Alice onto the first two deterministic warning tiles so
    // Carol wins and the room returns to its rematch lobby quickly.
    await waitFor(() => alice.state.platforms.get("3:4")?.state === "warning");
    hop(bob, 1, "3:4");
    await waitFor(() => alice.state.players.get(bob.sessionId)?.alive === false, 5_000);
    await waitFor(() => alice.state.platforms.get("1:2")?.state === "warning", 5_000);
    hop(alice, 1, "1:2");
    await waitFor(() => alice.state.phase === "results", 5_000);
    expect(alice.state.winnerSessionId).toBe(carol.sessionId);
    await waitFor(() => alice.state.phase === "lobby", 10_000);

    carol.reconnection.enabled = false;
    carol.connection.close();
    await waitFor(() => alice.state.players.get(carol.sessionId)?.connected === false);
    const token = carol.reconnectionToken;
    if (token === undefined) {
      throw new Error("Missing Carol reconnection token");
    }

    alice.send("play_again", {});
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(alice.state.phase).toBe("lobby");
    expect(alice.state.roundNumber).toBe(0);

    const reconnectedCarol = await test.testServer.sdk.reconnect(token, FallingPlatformsState);
    await waitFor(() => alice.state.phase === "playing", 10_000);
    expect(reconnectedCarol.state.players.size).toBe(3);
    expect(alice.state.aliveCount).toBe(3);
  }, 30_000);

  it("rejects direct matchmaking creation without the server room token", async () => {
    await expect(
      matchMaker.create(FALLING_PLATFORMS_ROOM_TYPE, {
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
