import { randomBytes } from "node:crypto";

import {
  type ISeatReservation,
  LobbyRoomState,
  PONG_CONSTANTS,
  PongState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { matchMaker } from "colyseus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGameRegistry } from "../../../src/games/game-registry.js";
import { createPongGameDefinition, PONG_ROOM_TYPE } from "../../../src/games/pong/definition.js";
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

type PongClientRoom = SendRoom &
  MessageRoom & {
    state: PongState;
    sessionId: string;
    reconnectionToken?: string;
    connection: { close: () => void };
    leave: () => Promise<void>;
  };

async function consumeLobby(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LobbyRoomState,
  );
}

async function consumeGame(test: TestPlatform, reservation: unknown): Promise<PongClientRoom> {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    PongState,
  ) as unknown as Promise<PongClientRoom>;
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

function waitForPaddleRejection(
  room: MessageRoom,
  sequence: number,
): Promise<{ sequence: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for paddle rejection ${sequence}`)),
      5_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === "paddle-rejected") {
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

function paddleMove(room: SendRoom, sequence: number, target: number): void {
  room.send("game:paddle-move", { type: "paddle_move", sequence, target });
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
  const room = await matchMaker.create(PONG_ROOM_TYPE, {
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

function snapshot(room: PongClientRoom) {
  return {
    phase: room.state.phase,
    ballCount: room.state.balls.size,
    desiredBallCount: room.state.desiredBallCount,
    players: [...room.state.players.entries()].map(([sessionId, player]) => ({
      sessionId,
      paddleCenter: player.paddleCenter,
      score: player.score,
      worldEdge: player.worldEdge,
    })),
  };
}

describe("Pong room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createPongGameDefinition(ROOM_CREATION_TOKEN)]),
      createTestConfig(E2E_CONFIG),
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs the full lobby-to-game transition, a two-player race to 10, and a rematch", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "pong" });
    await waitFor(() => aliceLobby.state.gameId === "pong");

    const bobStartError = waitForRoomError(bobLobby, "NOT_HOST");
    bobLobby.send("start_game", {});
    await bobStartError;

    const aliceTransition = waitForTransition(aliceLobby);
    const bobTransition = waitForTransition(bobLobby);
    aliceLobby.send("start_game", {});

    const [alicePayload, bobPayload] = await Promise.all([aliceTransition, bobTransition]);
    const alice = await consumeGame(test, alicePayload.reservation);
    const bob = await consumeGame(test, bobPayload.reservation);
    await waitFor(() => alice.state.players.size === 2);
    await waitFor(() => alice.state.phase === "countdown");
    expect(bob.state.phase).toBe("countdown");
    expect(alice.state.roomCode).toBe(created.body.room.code);
    expect(alice.state.gameId).toBe("pong");
    expect(alice.state.balls.size).toBe(1);
    expect(alice.state.players.size).toBe(2);
    expect("seed" in alice.state).toBe(false);

    // Every player has one opening, one paddle, one score and one colour.
    const alicePlayer = alice.state.players.get(alice.sessionId);
    const bobPlayer = bob.state.players.get(bob.sessionId);
    if (!alicePlayer || !bobPlayer) {
      throw new Error("missing players");
    }
    expect(alicePlayer.worldEdge).not.toBe(bobPlayer.worldEdge);
    expect(alicePlayer.openingEnd - alicePlayer.openingStart).toBeCloseTo(
      PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.TWO_PLAYER_GOAL_RATIO,
      5,
    );
    expect(bobPlayer.openingEnd - bobPlayer.openingStart).toBeCloseTo(
      alicePlayer.openingEnd - alicePlayer.openingStart,
      5,
    );
    expect(alicePlayer.paddleLength).toBe(bobPlayer.paddleLength);
    expect(alicePlayer.color).not.toBe(bobPlayer.color);
    expect(alicePlayer.score).toBe(0);
    expect(bobPlayer.score).toBe(0);

    await waitFor(() => alice.state.phase === "running", 10_000);
    expect(bob.state.phase).toBe("running");
    const firstBall = [...alice.state.balls.values()][0];
    expect(firstBall?.spawnState).toBe("moving");
    expect(Math.hypot(firstBall?.vx ?? 0, firstBall?.vy ?? 0)).toBeCloseTo(
      alice.state.ballSpeed,
      3,
    );

    // Escalation adds the second ball after the fixed E2E interval on both clients.
    await waitFor(() => alice.state.desiredBallCount === 2, 10_000);
    await waitFor(() => alice.state.balls.size === 2, 10_000);
    expect(bob.state.desiredBallCount).toBe(2);
    expect(bob.state.balls.size).toBe(2);

    // The deterministic E2E launch reaches Alice's centred paddle; the paddle
    // hit transfers shared ball ownership without any client input.
    await waitFor(
      () =>
        [...alice.state.balls.values()].some(
          (ball) => ball.spawnState === "moving" && ball.ownerSessionId === alice.sessionId,
        ),
      30_000,
    );

    // Run the match to completion; both clients must agree on the result.
    await waitFor(() => alice.state.phase === "finished", 90_000);
    await waitFor(() => bob.state.phase === "finished", 10_000);
    const afterFinish = waitForPaddleRejection(alice, 999);
    paddleMove(alice, 999, 0.5);
    expect((await afterFinish).reason).toBe("not-running");
    const aliceResult = alice.state.result;
    const bobResult = bob.state.result;
    if (aliceResult === null || bobResult === null) {
      throw new Error("expected match results");
    }
    expect([...aliceResult.winnerSessionIds]).toContain(alice.sessionId);
    expect([...aliceResult.winnerSessionIds]).toEqual([...bobResult.winnerSessionIds]);
    expect(snapshot(alice)).toEqual(snapshot(bob));
    const aliceScore = alice.state.players.get(alice.sessionId)?.score ?? 0;
    const bobScore = bob.state.players.get(bob.sessionId)?.score ?? 0;
    expect(aliceScore).toBeGreaterThanOrEqual(PONG_CONSTANTS.TARGET_SCORE);
    expect(bobScore).toBeLessThan(PONG_CONSTANTS.TARGET_SCORE);

    // Host rematch resets scores, ball count, and elapsed time.
    const nonHostAgain = waitForRoomError(bob, "NOT_HOST");
    bob.send("play_again", {});
    await nonHostAgain;
    alice.send("play_again", {});
    await waitFor(() => alice.state.phase === "countdown", 10_000);
    await waitFor(() => bob.state.phase === "countdown", 10_000);
    expect(alice.state.balls.size).toBe(1);
    expect(alice.state.desiredBallCount).toBe(1);
    expect(alice.state.matchElapsedMs).toBe(0);
    expect(alice.state.players.get(alice.sessionId)?.score).toBe(0);
    expect(bob.state.players.get(bob.sessionId)?.score).toBe(0);
  }, 180_000);

  it("starts an eight-player match and keeps every client's control private and state consistent", async () => {
    const { reservations } = await createDirectRoom(8);
    const clients: PongClientRoom[] = [];
    for (const reservation of reservations) {
      clients.push(await consumeGame(test, reservation));
    }
    const first = clients[0];
    if (!first) {
      throw new Error("missing first client");
    }
    await waitFor(() => first.state.phase === "countdown");
    expect(first.state.players.size).toBe(8);
    expect([...first.state.players.values()].every((player) => player.paddleLength > 0)).toBe(true);
    const before = snapshot(first);

    // Simultaneous, distinct intents: every client moves only its own paddle
    // to its own target; no other paddle moves.
    for (let index = 0; index < clients.length; index++) {
      const client = clients[index];
      if (!client) {
        continue;
      }
      paddleMove(client, 1, index / 7);
    }
    await waitFor(() => first.state.phase === "running", 10_000);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    for (let index = 0; index < clients.length; index++) {
      const client = clients[index];
      if (!client) {
        continue;
      }
      const player = client.state.players.get(client.sessionId);
      if (!player) {
        throw new Error("missing player");
      }
      const expected = player.paddleMin + (index / 7) * (player.paddleMax - player.paddleMin);
      expect(player.paddleCenter).toBeCloseTo(expected, 3);
    }
    const after = snapshot(first);
    for (const client of clients.slice(1)) {
      expect(snapshot(client)).toEqual(after);
    }
    expect(after.players.length).toBe(8);
    expect(before.players.map((entry) => entry.paddleCenter)).not.toEqual(
      after.players.map((entry) => entry.paddleCenter),
    );

    // A second intent from the same client overrides the first (ordering).
    const playerZero = clients[0];
    if (!playerZero) {
      throw new Error("missing player zero");
    }
    paddleMove(playerZero, 2, 1);
    paddleMove(playerZero, 3, 0);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const zeroPlayer = playerZero.state.players.get(playerZero.sessionId);
    expect(zeroPlayer?.paddleCenter).toBeCloseTo((zeroPlayer?.paddleMin ?? 0) + 0.001, 2);
  }, 60_000);

  it("keeps the starting five-ball cap when players leave an eight-player match", async () => {
    const { reservations } = await createDirectRoom(8);
    const clients: PongClientRoom[] = [];
    for (const reservation of reservations) {
      clients.push(await consumeGame(test, reservation));
    }
    const first = clients[0];
    if (!first) {
      throw new Error("missing first client");
    }
    await waitFor(() => first.state.phase === "running", 10_000);
    await waitFor(() => first.state.desiredBallCount === 5, 10_000);
    await waitFor(() => first.state.balls.size === 5, 10_000);

    const second = clients[1];
    const third = clients[2];
    if (!second || !third) {
      throw new Error("missing leaving clients");
    }
    await second.leave();
    await third.leave();
    await waitFor(() => first.state.players.size === 6, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(first.state.desiredBallCount).toBe(5);
    expect(first.state.balls.size).toBeLessThanOrEqual(5);
  }, 30_000);

  it("rejects invalid, stale, forged, and out-of-phase paddle messages", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);

    // Sending before the match runs is rejected without corrupting state.
    const beforeStart = waitForPaddleRejection(alice, 1);
    paddleMove(alice, 1, 0.5);
    expect((await beforeStart).reason).toBe("not-running");
    const alicePlayer = alice.state.players.get(alice.sessionId);
    if (alicePlayer) {
      expect(alicePlayer.paddleCenter).toBe((alicePlayer.paddleMin + alicePlayer.paddleMax) / 2);
    }

    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "running", 10_000);
    const invalidCommand = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:paddle-move", { command: { type: "teleport" } });
    await invalidCommand;

    const cheat = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:paddle-move", {
      type: "paddle_move",
      sequence: 2,
      target: 0.5,
      playerId: bob.sessionId,
      paddleCenter: 999,
      score: 10,
    });
    await cheat;

    paddleMove(alice, 3, 0.25);
    const stale = waitForPaddleRejection(alice, 3);
    paddleMove(alice, 3, 0.75);
    expect((await stale).reason).toBe("stale-sequence");

    // Alice's command moves only Alice's paddle.
    const bobBefore = bob.state.players.get(bob.sessionId)?.paddleCenter ?? 0;
    const aliceBefore = alice.state.players.get(alice.sessionId)?.paddleCenter ?? 0;
    paddleMove(alice, 4, 1);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const aliceAfter = alice.state.players.get(alice.sessionId)?.paddleCenter ?? 0;
    const bobAfter = bob.state.players.get(bob.sessionId)?.paddleCenter ?? 0;
    expect(aliceAfter).toBeGreaterThan(aliceBefore);
    expect(bobAfter).toBe(bobBefore);
  }, 30_000);

  it("recovers a disconnected player's slot and keeps the match running", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "running", 10_000);
    // Colyseus only allows reconnection after the room has been up for 5s.
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    const bobSessionId = bob.sessionId;
    const bobToken = bob.reconnectionToken;
    if (bobToken === undefined) {
      throw new Error("Expected Bob's reconnection token");
    }
    // Disable the SDK's automatic reconnect so the test exercises the
    // server-side allowReconnection path with an explicit reconnect call.
    (bob as unknown as { reconnection: { enabled: boolean } }).reconnection.enabled = false;
    const bobPlayerBefore = bob.state.players.get(bobSessionId);
    if (!bobPlayerBefore) {
      throw new Error("missing Bob");
    }
    const bobWorldEdge = bobPlayerBefore.worldEdge;
    const bobSlot = bobPlayerBefore.slotIndex;
    const bobPaddle = bobPlayerBefore.paddleCenter;

    bob.connection.close();
    await waitFor(
      () => alice.state.players.get(bobSessionId)?.connectionStatus === "reconnecting",
      10_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(alice.state.players.get(bobSessionId)?.connectionStatus).toBe("reconnecting");
    expect(alice.state.phase === "running" || alice.state.phase === "finished").toBe(true);

    const reconnected = await test.testServer.sdk.reconnect(bobToken);
    expect(reconnected.sessionId).toBe(bobSessionId);
    await waitFor(
      () => alice.state.players.get(bobSessionId)?.connectionStatus === "connected",
      10_000,
    );
    const bobAfter = bob.state.players.get(bobSessionId);
    if (!bobAfter) {
      throw new Error("missing Bob after reconnect");
    }
    expect(bobAfter.worldEdge).toBe(bobWorldEdge);
    expect(bobAfter.slotIndex).toBe(bobSlot);
    expect(bobAfter.paddleCenter).toBeCloseTo(bobPaddle, 5);
    expect(bobAfter.score).toBe(bobPlayerBefore.score);
    expect(alice.state.players.get(bobSessionId)?.connectionStatus).toBe("connected");
    expect(alice.state.phase === "running" || alice.state.phase === "finished").toBe(true);
    await waitFor(() => alice.state.balls.size === bob.state.balls.size);
  }, 30_000);

  it("continues and transfers host when a player permanently leaves mid-match", async () => {
    const { reservations } = await createDirectRoom(2);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "running", 10_000);

    await alice.leave();
    await waitFor(() => bob.state.players.size === 1, 10_000);
    expect(bob.state.hostSessionId).toBe(bob.sessionId);
    expect(bob.state.phase).toBe("running");
    const elapsedBefore = bob.state.matchElapsedMs;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(bob.state.matchElapsedMs).toBeGreaterThan(elapsedBefore);
    const bobPlayer = bob.state.players.get(bob.sessionId);
    if (!bobPlayer) {
      throw new Error("missing Bob");
    }
    const startingPaddleCenter = bobPlayer.paddleCenter;
    paddleMove(bob, 1, 0);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const leftPosition = bob.state.players.get(bob.sessionId)?.paddleCenter ?? 0;
    expect(leftPosition).toBeLessThan(startingPaddleCenter);
    paddleMove(bob, 2, 1);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(bob.state.players.get(bob.sessionId)?.paddleCenter ?? 0).toBeGreaterThan(leftPosition);
  }, 30_000);

  it("disposes the game room when a roster player never arrives", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "pong" });
    await waitFor(() => aliceLobby.state.gameId === "pong");

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
      matchMaker.create(PONG_ROOM_TYPE, {
        roomCode: "ABCDEF",
        players: playerIds(2),
      }),
    ).rejects.toThrow();
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
