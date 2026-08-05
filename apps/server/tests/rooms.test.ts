import {
  type ApiError,
  apiErrorSchema,
  type CreateRoomResponse,
  createRoomResponseSchema,
  LobbyRoomState,
} from "@phone-party/protocol";
import { matchMaker } from "colyseus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOBBY_ROOM_TYPE } from "../src/rooms/lobby-room.js";
import {
  cookieValue,
  createTestPlatform,
  expectDefined,
  stopTestPlatform,
  type TestPlatform,
  waitFor,
} from "./helpers/test-platform.js";

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
});
