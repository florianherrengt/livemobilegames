import { matchMaker, Room } from "@colyseus/core";
import {
  type ApiError,
  apiErrorSchema,
  type CreateRoomResponse,
  createRoomResponseSchema,
  type GameManifest,
  type ISeatReservation,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GameDefinition } from "../src/games/game-definition.js";
import { createGameRegistry } from "../src/games/game-registry.js";
import { LOBBY_ROOM_TYPE } from "../src/rooms/lobby-room.js";
import { TestRoomState } from "./fixtures/test-game-room.js";
import {
  cookieValue,
  createTestConfig,
  createTestPlatform,
  expectDefined,
  stopTestPlatform,
  type TestPlatform,
  waitFor,
} from "./helpers/test-platform.js";

type MessageRoom = {
  onMessage: (
    type: "*",
    callback: (messageType: string | number, payload: unknown) => void,
  ) => () => void;
};

const SLOW_TRANSITION_ROOM_TYPE = "slow-transition-test-room";
let slowTransitionCreated: (() => void) | undefined;
let slowTransitionGate: Promise<void> = Promise.resolve();

class SlowTransitionTestRoom extends Room<{ state: TestRoomState }> {
  declare state: TestRoomState;
  // One unconsumed creator reservation plus the two roster reservations.
  override maxClients = 3;

  override async onCreate(): Promise<void> {
    this.state = new TestRoomState();
    this.seatReservationTimeout = 5;
    slowTransitionCreated?.();
    await slowTransitionGate;
  }
}

const slowTransitionManifest = {
  id: "slow-transition-test",
  name: "Slow Transition Test",
  description: "Test-only transition barrier",
  version: 1,
  minPlayers: 1,
  maxPlayers: 2,
  orientation: "any",
} satisfies GameManifest;

const slowTransitionDefinition: GameDefinition = {
  manifest: slowTransitionManifest,
  roomType: SLOW_TRANSITION_ROOM_TYPE,
  roomClass: SlowTransitionTestRoom,
};

type RoomApiResult = {
  body: CreateRoomResponse | ApiError;
  cookie: string | undefined;
  response: Response;
};

function parseRoomBody(json: unknown): CreateRoomResponse | ApiError {
  const created = createRoomResponseSchema.safeParse(json);
  if (created.success) {
    return created.data;
  }
  const error = apiErrorSchema.safeParse(json);
  if (error.success) {
    return error.data;
  }
  throw new Error("Unexpected API response shape");
}

function expectRoomSuccess(body: CreateRoomResponse | ApiError): CreateRoomResponse {
  if ("error" in body) {
    throw new Error("Expected a successful response");
  }
  return body;
}

function expectRoomError(body: CreateRoomResponse | ApiError): ApiError {
  if (!("error" in body)) {
    throw new Error("Expected an error response");
  }
  return body;
}

function apiUrl(platform: TestPlatform, path: string): string {
  return `http://127.0.0.1:${platform.testServer.sdk.settings.port}${path}`;
}

function waitForTransition(room: MessageRoom): Promise<RoomTransition> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for room transition")),
      5_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === ROOM_MESSAGE_TYPES.transition) {
        clearTimeout(timer);
        off();
        resolve(payload as RoomTransition);
      }
    });
  });
}

async function createRoom(
  platform: TestPlatform,
  playerName: string,
  cookie?: string,
): Promise<RoomApiResult> {
  const url = apiUrl(platform, "/api/rooms");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      connection: "close",
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body: JSON.stringify({ playerName }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = parseRoomBody(await response.json());
  const setCookie = response.headers.get("set-cookie");
  return { body, cookie: cookieValue(setCookie), response };
}

async function joinRoom(
  platform: TestPlatform,
  code: string,
  playerName: string,
  cookie?: string,
): Promise<RoomApiResult> {
  const response = await fetch(apiUrl(platform, `/api/rooms/${code}/join`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      connection: "close",
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body: JSON.stringify({ playerName }),
  });
  const body = parseRoomBody(await response.json());
  const setCookie = response.headers.get("set-cookie");
  return { body, cookie: cookieValue(setCookie), response };
}

describe("room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform();
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("exposes the test fixture only on the test server", async () => {
    const response = await test.platform.app.request("/api/games");
    expect(await response.json()).toEqual({
      games: [
        expect.objectContaining({
          id: "test-platform-room",
          name: "Test Platform Room",
        }),
      ],
    });
  });

  it("creates a lobby room, consumes the creator reservation and joins with a second player", async () => {
    const created = await createRoom(test, "Alice");
    expect(created.response.status).toBe(201);
    const createdBody = expectRoomSuccess(created.body);
    expect(createdBody.room.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(createdBody.room.game).toBeNull();
    expect(created.cookie).toBeDefined();

    const creatorRoom = await test.testServer.sdk.consumeSeatReservation(
      createdBody.reservation,
      LobbyRoomState,
    );
    await waitFor(() => creatorRoom.state.roomCode === createdBody.room.code);
    expect(creatorRoom.roomId).toBe(createdBody.reservation.roomId);

    const joined = await joinRoom(test, createdBody.room.code, "Bob");
    expect(joined.response.status).toBe(200);
    const joinedBody = expectRoomSuccess(joined.body);
    const secondRoom = await test.testServer.sdk.consumeSeatReservation(
      joinedBody.reservation,
      LobbyRoomState,
    );
    await waitFor(() => creatorRoom.state.players.size === 2);
    expect(secondRoom.roomId).toBe(creatorRoom.roomId);
  });

  it("joins two distinct trusted identities into the same room and cleans up", async () => {
    const alice = await createRoom(test, "Alice");
    const aliceBody = expectRoomSuccess(alice.body);
    const aliceRoom = await test.testServer.sdk.consumeSeatReservation(
      aliceBody.reservation,
      LobbyRoomState,
    );

    const bob = await joinRoom(test, aliceBody.room.code.toLowerCase(), "Bob");
    const bobBody = expectRoomSuccess(bob.body);
    const bobRoom = await test.testServer.sdk.consumeSeatReservation(
      bobBody.reservation,
      LobbyRoomState,
    );
    await waitFor(() => aliceRoom.state.players.size === 2);

    expect(bobRoom.roomId).toBe(aliceRoom.roomId);
    const players = [...aliceRoom.state.players.values()];
    expect(players).toHaveLength(2);
    expect(players[0]?.playerId).not.toBe(players[1]?.playerId);
    expect(new Set(players.map((player) => player.name))).toEqual(new Set(["Alice", "Bob"]));
  });

  it("holds a dropped lobby host for reconnection without transferring ownership", async () => {
    const alice = await createRoom(test, "Alice");
    const aliceBody = expectRoomSuccess(alice.body);
    const aliceRoom = await test.testServer.sdk.consumeSeatReservation(
      aliceBody.reservation,
      LobbyRoomState,
    );
    const bob = await joinRoom(test, aliceBody.room.code, "Bob");
    const bobRoom = await test.testServer.sdk.consumeSeatReservation(
      expectRoomSuccess(bob.body).reservation,
      LobbyRoomState,
    );
    await waitFor(() => bobRoom.state.players.size === 2);

    // Colyseus only enables explicit reconnection after the room has been up
    // for five seconds. Disable SDK auto-reconnect so this exercises the
    // lobby's server-side allowReconnection path directly.
    await new Promise((resolve) => setTimeout(resolve, 5_200));
    const aliceSessionId = aliceRoom.sessionId;
    const token = aliceRoom.reconnectionToken;
    if (token === undefined) {
      throw new Error("Expected a lobby reconnection token");
    }
    (aliceRoom as unknown as { reconnection: { enabled: boolean } }).reconnection.enabled = false;
    aliceRoom.connection.close();

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(bobRoom.state.players.size).toBe(2);
    expect(bobRoom.state.hostSessionId).toBe(aliceSessionId);

    const reconnected = await test.testServer.sdk.reconnect(token, LobbyRoomState);
    expect(reconnected.sessionId).toBe(aliceSessionId);
    await waitFor(() => bobRoom.state.players.size === 2);
    expect(bobRoom.state.hostSessionId).toBe(aliceSessionId);
  }, 15_000);

  it("resends a pending game transition after a lobby client reconnects", async () => {
    await stopTestPlatform(test);
    let releaseTransition!: () => void;
    slowTransitionGate = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });
    let markTransitionCreated!: () => void;
    const transitionCreated = new Promise<void>((resolve) => {
      markTransitionCreated = resolve;
    });
    slowTransitionCreated = markTransitionCreated;
    test = await createTestPlatform(
      createGameRegistry([slowTransitionDefinition]),
      createTestConfig({
        CAPITAL_PIN_TRANSITION_TIMEOUT_MS: "6000",
        LOBBY_MAX_CLIENTS: "3",
      }),
    );

    const alice = await createRoom(test, "Alice");
    const aliceBody = expectRoomSuccess(alice.body);
    const aliceRoom = await test.testServer.sdk.consumeSeatReservation(
      aliceBody.reservation,
      LobbyRoomState,
    );
    const bob = await joinRoom(test, aliceBody.room.code, "Bob");
    const bobRoom = await test.testServer.sdk.consumeSeatReservation(
      expectRoomSuccess(bob.body).reservation,
      LobbyRoomState,
    );
    await waitFor(() => aliceRoom.state.players.size === 2);

    const bobToken = bobRoom.reconnectionToken;
    if (bobToken === undefined) {
      throw new Error("Expected Bob's lobby reconnection token");
    }
    (bobRoom as unknown as { reconnection: { enabled: boolean } }).reconnection.enabled = false;

    try {
      const aliceTransitionPromise = waitForTransition(aliceRoom);
      aliceRoom.send(ROOM_MESSAGE_TYPES.selectGame, { gameId: slowTransitionManifest.id });
      await waitFor(() => aliceRoom.state.gameId === slowTransitionManifest.id);
      aliceRoom.send(ROOM_MESSAGE_TYPES.startGame, {});
      await transitionCreated;

      const lateJoin = await joinRoom(test, aliceBody.room.code, "Charlie");
      expect(lateJoin.response.status).toBe(409);
      expect(expectRoomError(lateJoin.body).error.code).toBe("ROOM_FULL");

      // Drop after the trusted roster has been captured, but before the
      // transition result is broadcast. This used to strand Bob because the
      // lobby closed two seconds later and never retained his reservation.
      bobRoom.connection.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseTransition();

      const aliceTransition = await aliceTransitionPromise;
      await new Promise((resolve) => setTimeout(resolve, 2_200));
      const reconnectedBob = await test.testServer.sdk.reconnect(bobToken, LobbyRoomState);
      const bobTransitionPromise = waitForTransition(reconnectedBob);
      reconnectedBob.send(ROOM_MESSAGE_TYPES.resumeTransition, {});
      const bobTransition = await bobTransitionPromise;

      expect(bobTransition.reservation.roomId).toBe(aliceTransition.reservation.roomId);
      const [aliceGame, bobGame] = await Promise.all([
        test.testServer.sdk.consumeSeatReservation(
          aliceTransition.reservation as ISeatReservation,
          TestRoomState,
        ),
        test.testServer.sdk.consumeSeatReservation(
          bobTransition.reservation as ISeatReservation,
          TestRoomState,
        ),
      ]);
      expect(bobGame.roomId).toBe(aliceGame.roomId);
    } finally {
      releaseTransition();
      slowTransitionCreated = undefined;
      slowTransitionGate = Promise.resolve();
    }
  }, 15_000);

  it("transfers lobby ownership after the host intentionally leaves", async () => {
    const alice = await createRoom(test, "Alice");
    const aliceBody = expectRoomSuccess(alice.body);
    const aliceRoom = await test.testServer.sdk.consumeSeatReservation(
      aliceBody.reservation,
      LobbyRoomState,
    );
    const bob = await joinRoom(test, aliceBody.room.code, "Bob");
    const bobRoom = await test.testServer.sdk.consumeSeatReservation(
      expectRoomSuccess(bob.body).reservation,
      LobbyRoomState,
    );
    await waitFor(() => bobRoom.state.players.size === 2);

    await aliceRoom.leave();
    await waitFor(() => bobRoom.state.players.size === 1);
    expect(bobRoom.state.hostSessionId).toBe(bobRoom.sessionId);
    expect(bobRoom.state.players.get(bobRoom.sessionId)?.isHost).toBe(true);
  });

  it("rejects a second live membership for the same trusted identity", async () => {
    const alice = await createRoom(test, "Alice");
    const aliceBody = expectRoomSuccess(alice.body);
    const aliceRoom = await test.testServer.sdk.consumeSeatReservation(
      aliceBody.reservation,
      LobbyRoomState,
    );
    await waitFor(() => aliceRoom.state.players.size === 1);

    const duplicate = await joinRoom(test, aliceBody.room.code, "Alice again", alice.cookie);
    expect(duplicate.response.status).toBe(200);
    await expect(
      test.testServer.sdk.consumeSeatReservation(
        expectRoomSuccess(duplicate.body).reservation,
        LobbyRoomState,
      ),
    ).rejects.toThrow();
    expect(aliceRoom.state.players.size).toBe(1);
  });

  it("normalises lowercase room codes", async () => {
    const created = await createRoom(test, "Alice");
    const createdBody = expectRoomSuccess(created.body);
    const joined = await joinRoom(test, createdBody.room.code.toLowerCase(), "Bob");
    expect(joined.response.status).toBe(200);
    expect(expectRoomSuccess(joined.body).room.code).toBe(createdBody.room.code);
  });

  it("returns ROOM_NOT_FOUND for an unknown code", async () => {
    const joined = await joinRoom(test, "AAAAAA", "Bob");
    expect(joined.response.status).toBe(404);
    expect(expectRoomError(joined.body).error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns ROOM_FULL when a room reaches its maximum", async () => {
    const created = await createRoom(test, "Alice");
    const createdBody = expectRoomSuccess(created.body);
    await test.testServer.sdk.consumeSeatReservation(createdBody.reservation, LobbyRoomState);

    const bob = await joinRoom(test, createdBody.room.code, "Bob");
    expect(bob.response.status).toBe(200);
    await test.testServer.sdk.consumeSeatReservation(
      expectRoomSuccess(bob.body).reservation,
      LobbyRoomState,
    );

    const charlie = await joinRoom(test, createdBody.room.code, "Charlie");
    expect(charlie.response.status).toBe(409);
    expect(expectRoomError(charlie.body).error.code).toBe("ROOM_FULL");
  });

  it("removes stale mappings and returns ROOM_EXPIRED", async () => {
    const code = "ABCDEF";
    test.platform.roomDirectory.setEntry(code, { roomId: "missing-room", gameId: null });
    const joined = await joinRoom(test, code, "Bob");
    expect(joined.response.status).toBe(404);
    expect(expectRoomError(joined.body).error.code).toBe("ROOM_EXPIRED");
    expect(test.platform.roomDirectory.hasCode(code)).toBe(false);
  });

  it("does not trust a player id supplied by the client", async () => {
    const response = await fetch(apiUrl(test, "/api/rooms"), {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({
        playerName: "Alice",
        playerId: "11111111-1111-4111-8111-111111111111",
      }),
    });
    const body = parseRoomBody(await response.json());
    const parsedBody = expectRoomSuccess(body);
    const room = await test.testServer.sdk.consumeSeatReservation(
      parsedBody.reservation,
      LobbyRoomState,
    );
    await waitFor(() => room.state.players.size === 1);

    const players = [...room.state.players.values()];
    expect(players).toHaveLength(1);
    expect(players[0]?.playerId).not.toBe("11111111-1111-4111-8111-111111111111");
    expect(players[0]?.name).toBe("Alice");
  });

  it("removes the room-code mapping when the room is disposed", async () => {
    const created = await createRoom(test, "Alice");
    const createdBody = expectRoomSuccess(created.body);
    await test.testServer.sdk.consumeSeatReservation(createdBody.reservation, LobbyRoomState);
    expect(test.platform.roomDirectory.hasCode(createdBody.room.code)).toBe(true);

    const room = expectDefined(matchMaker.getLocalRoomById(createdBody.reservation.roomId));
    await room.disconnect();
    await waitFor(() => !test.platform.roomDirectory.hasCode(createdBody.room.code));
    expect(test.platform.roomDirectory.getByCode(createdBody.room.code)).toBeUndefined();
  });

  it("lets the host choose a game from the trusted registry", async () => {
    const created = await createRoom(test, "Alice");
    const createdBody = expectRoomSuccess(created.body);
    const aliceRoom = await test.testServer.sdk.consumeSeatReservation(
      createdBody.reservation,
      LobbyRoomState,
    );
    await waitFor(() => aliceRoom.state.roomCode === createdBody.room.code);

    aliceRoom.send("select_game", { gameId: "test-platform-room" });
    await waitFor(() => aliceRoom.state.gameId === "test-platform-room");
  });

  it("rejects an unknown game selection", async () => {
    const created = await createRoom(test, "Alice");
    const createdBody = expectRoomSuccess(created.body);
    const aliceRoom = await test.testServer.sdk.consumeSeatReservation(
      createdBody.reservation,
      LobbyRoomState,
    );
    await waitFor(() => aliceRoom.state.roomCode === createdBody.room.code);

    let errorMessage: string | null = null;
    aliceRoom.onError.once((_code, message) => {
      errorMessage = String(message);
    });
    aliceRoom.send("select_game", { gameId: "missing-game" });
    await waitFor(() => errorMessage !== null);
    expect(errorMessage).toContain("Game not found");
  });

  it("uses the platform lobby room type for matchmaking", async () => {
    const created = await createRoom(test, "Alice");
    expect(expectRoomSuccess(created.body).reservation.name).toBe(LOBBY_ROOM_TYPE);
  });

  it("rejects direct public matchmaking creation of a platform lobby", async () => {
    await expect(
      test.testServer.sdk.create(
        LOBBY_ROOM_TYPE,
        {
          roomCode: "ABCDEF",
          creatorPlayerId: "11111111-1111-4111-8111-111111111111",
          playerId: "11111111-1111-4111-8111-111111111111",
          playerName: "Mallory",
          maxClients: 2,
        },
        LobbyRoomState,
      ),
    ).rejects.toThrow();
  });

  it("rejects direct public matchmaking reservations for a platform lobby", async () => {
    const created = await createRoom(test, "Alice");
    const createdBody = expectRoomSuccess(created.body);
    await test.testServer.sdk.consumeSeatReservation(createdBody.reservation, LobbyRoomState);

    await expect(
      test.testServer.sdk.joinById(
        createdBody.reservation.roomId,
        {
          playerId: "22222222-2222-4222-8222-222222222222",
          playerName: "Mallory",
        },
        LobbyRoomState,
      ),
    ).rejects.toThrow();
  });
});
