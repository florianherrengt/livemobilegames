import { createRoomResponseSchema, joinRoomResponseSchema } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createGameRegistry } from "../src/games/game-registry.js";
import { createLogger } from "../src/logging.js";
import { RoomDirectory } from "../src/rooms/room-directory.js";
import { RoomService } from "../src/rooms/room-service.js";
import { asRecord } from "./helpers/json.js";
import { createTestConfig } from "./helpers/test-platform.js";

const ROOM_CREATION_TOKEN = "test-room-creation-token";

function createAppWithStub() {
  const registry = createGameRegistry([]);
  const roomService = new RoomService({
    directory: new RoomDirectory(),
    isShuttingDown: () => false,
    lobbyMaxClients: 2,
    logger: createLogger("silent"),
    roomCreationToken: ROOM_CREATION_TOKEN,
  });
  const reservation = {
    name: "__platform_lobby",
    sessionId: "session-1",
    roomId: "room-1",
    processId: "process-1",
  };
  roomService.createRoom = async () =>
    createRoomResponseSchema.parse({ room: { code: "ABC234", game: null }, reservation });
  roomService.joinRoom = async () =>
    joinRoomResponseSchema.parse({ room: { code: "ABC234", game: null }, reservation });
  return createApp({
    config: createTestConfig(),
    logger: createLogger("silent"),
    roomService,
    registry,
  });
}

describe("Hono application", () => {
  it("serves /api/health without an anonymous session", async () => {
    const app = createAppWithStub();
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns an empty production game catalogue", async () => {
    const app = createAppWithStub();
    const response = await app.request("/api/games");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ games: [] });
  });

  it("returns INVALID_REQUEST for an invalid create-room payload", async () => {
    const app = createAppWithStub();
    const response = await app.request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: "avoid-the-laser", playerName: "" }),
    });
    expect(response.status).toBe(400);
    const body = asRecord(await response.json());
    const error = asRecord(body.error);
    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "playerName",
          message: expect.any(String),
        }),
      ]),
    );
  });

  it("returns INVALID_REQUEST for malformed JSON", async () => {
    const app = createAppWithStub();
    const response = await app.request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"gameId":',
    });
    expect(response.status).toBe(400);
    const body = asRecord(await response.json());
    expect(asRecord(body.error).code).toBe("INVALID_REQUEST");
  });

  it("returns INVALID_REQUEST for a missing body", async () => {
    const app = createAppWithStub();
    const response = await app.request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
    const body = asRecord(await response.json());
    expect(asRecord(body.error).code).toBe("INVALID_REQUEST");
  });

  it("strips unknown fields instead of rejecting them", async () => {
    const app = createAppWithStub();
    const response = await app.request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameId: "missing-game",
        playerName: "Alice",
        playerId: "11111111-1111-4111-8111-111111111111",
      }),
    });
    expect(response.status).toBe(201);
    const body = asRecord(await response.json());
    expect(asRecord(body.room).code).toBe("ABC234");
  });

  it("rate limits repeated room creation from one address without a retained cookie", async () => {
    const app = createAppWithStub();
    const responses: Response[] = [];

    for (let attempt = 0; attempt < 61; attempt += 1) {
      responses.push(
        await app.request("/api/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerName: "Alice" }),
        }),
      );
    }

    expect(responses.slice(0, 60).every((response) => response.status === 201)).toBe(true);
    expect(responses[60]?.status).toBe(429);
    const body = asRecord(await responses[60]?.json());
    expect(asRecord(body.error).code).toBe("RATE_LIMITED");
  });

  it("rate limits a retained anonymous player before the address ceiling", async () => {
    const app = createAppWithStub();
    const first = await app.request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "Alice" }),
    });
    const cookie = first.headers.get("set-cookie")?.split(";")[0];
    expect(first.status).toBe(201);
    expect(cookie).toBeDefined();

    const responses: Response[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      responses.push(
        await app.request("/api/rooms", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: cookie ?? "",
          },
          body: JSON.stringify({ playerName: "Alice" }),
        }),
      );
    }

    expect(responses.slice(0, 9).every((response) => response.status === 201)).toBe(true);
    expect(responses[9]?.status).toBe(429);
  });

  it("rate limits repeated joins from one address without a retained cookie", async () => {
    const app = createAppWithStub();
    const responses: Response[] = [];

    for (let attempt = 0; attempt < 121; attempt += 1) {
      responses.push(
        await app.request("/api/rooms/ABC234/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerName: "Bob" }),
        }),
      );
    }

    expect(responses.slice(0, 120).every((response) => response.status === 200)).toBe(true);
    expect(responses[120]?.status).toBe(429);
    const body = asRecord(await responses[120]?.json());
    expect(asRecord(body.error).code).toBe("RATE_LIMITED");
  });

  it("returns INVALID_REQUEST for invalid join route parameters", async () => {
    const app = createAppWithStub();
    const response = await app.request("/api/rooms/AB/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "Alice" }),
    });
    expect(response.status).toBe(400);
    const body = asRecord(await response.json());
    expect(asRecord(body.error).code).toBe("INVALID_REQUEST");
  });

  it("returns INVALID_REQUEST for whitespace-only and overlong names", async () => {
    const app = createAppWithStub();
    for (const playerName of ["   ", "a".repeat(31)]) {
      const response = await app.request("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId: "missing-game", playerName }),
      });
      expect(response.status).toBe(400);
      const body = asRecord(await response.json());
      expect(asRecord(body.error).code).toBe("INVALID_REQUEST");
    }
  });

  it("returns JSON NOT_FOUND for unknown API routes", async () => {
    const app = createAppWithStub();
    const response = await app.request("/api/nope");
    expect(response.status).toBe(404);
    const body = asRecord(await response.json());
    expect(asRecord(body.error).code).toBe("NOT_FOUND");
  });

  it("does not leak unexpected error details", async () => {
    const registry = createGameRegistry([]);
    const roomService = new RoomService({
      directory: new RoomDirectory(),
      isShuttingDown: () => false,
      lobbyMaxClients: 2,
      logger: createLogger("silent"),
      roomCreationToken: ROOM_CREATION_TOKEN,
    });
    roomService.createRoom = async () => {
      throw new Error("secret internal detail");
    };
    const app = createApp({
      config: loadConfig({
        NODE_ENV: "test",
        PORT: "0",
        HOST: "127.0.0.1",
        COOKIE_SECRET: "test-secret-0123456789abcdefghijklmnopqrstuv",
        PUBLIC_ORIGIN: "http://localhost:5173",
        COLYSEUS_PATH: "/colyseus",
        LOG_LEVEL: "silent",
      }),
      logger: createLogger("silent"),
      roomService,
      registry,
    });
    const response = await app.request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: "missing-game", playerName: "Alice" }),
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("secret internal detail");
  });
});
