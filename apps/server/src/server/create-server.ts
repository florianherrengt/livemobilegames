import { createServer } from "node:http";
import { defineRoom, defineServer, type RegisteredHandler } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { getRequestListener } from "@hono/node-server";
import type { NextFunction, Request, Response } from "express";
import type { Hono } from "hono";

import { createApp } from "../app.js";
import type { AppConfig } from "../config.js";
import type { AppEnv } from "../context.js";
import type { GameRegistry } from "../games/game-registry.js";
import type { Logger } from "../logging.js";
import { startGameTransition } from "../rooms/game-transition.js";
import { createLobbyRoomClass, LOBBY_ROOM_TYPE } from "../rooms/lobby-room.js";
import { RoomDirectory } from "../rooms/room-directory.js";
import { RoomService } from "../rooms/room-service.js";

/**
 * Live Drawing has an explicit 10,000-point/1,000-stroke turn bound. A fully
 * populated snapshot remains below this buffer, including the maximum player
 * and spectator roster. Colyseus's 8 KiB default is too small for a legitimate
 * late spectator or reconnect snapshot at that documented bound.
 */
export const COLYSEUS_SCHEMA_BUFFER_SIZE_BYTES = 256 * 1024;

export type PlatformServerDeps = {
  readonly config: AppConfig;
  readonly games: GameRegistry;
  readonly logger: Logger;
  readonly roomCreationToken: string;
};

export type PlatformServer = {
  readonly app: Hono<AppEnv>;
  readonly httpServer: ReturnType<typeof createServer>;
  readonly gameServer: ReturnType<typeof defineServer>;
  readonly roomDirectory: RoomDirectory;
  readonly roomService: RoomService;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export async function createPlatformServer(deps: PlatformServerDeps): Promise<PlatformServer> {
  Encoder.BUFFER_SIZE = COLYSEUS_SCHEMA_BUFFER_SIZE_BYTES;
  const httpServer = createServer();
  const transport = new WebSocketTransport({ noServer: true, maxPayload: 16 * 1024 });
  const colyseusPath = deps.config.colyseusPath.replace(/\/$/, "");
  let shuttingDown = false;

  transport.attachToServer(httpServer, {
    filter: (request) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      return url.pathname.startsWith(`${colyseusPath}/`);
    },
  });

  const roomDirectory = new RoomDirectory();
  const roomCreationToken = deps.roomCreationToken;
  const roomService = new RoomService({
    directory: roomDirectory,
    isShuttingDown: () => shuttingDown,
    lobbyMaxClients: deps.config.lobbyMaxClients,
    logger: deps.logger,
    roomCreationToken,
  });

  const app = createApp({
    config: deps.config,
    logger: deps.logger,
    roomService,
    registry: deps.games,
  });
  const honoListener = getRequestListener((request, env) => app.fetch(request, env));

  const rooms: Record<string, RegisteredHandler> = {};
  rooms[LOBBY_ROOM_TYPE] = defineRoom(
    createLobbyRoomClass({
      registry: deps.games,
      e2eMode: deps.config.e2eTestMode,
      e2eTurnDurationMs: deps.config.e2eTurnDurationMs,
      transitionTimeoutMs: deps.config.capitalPinTransitionTimeoutMs,
      roomCreationToken,
      logger: deps.logger,
      startGameTransition: (input) =>
        startGameTransition(roomDirectory, deps.games, {
          ...input,
          e2eMode: deps.config.e2eTestMode,
          e2eTurnDurationMs: deps.config.e2eTurnDurationMs,
          transitionTimeoutMs: deps.config.capitalPinTransitionTimeoutMs,
          roomCreationToken,
        }),
    }),
  );
  for (const definition of deps.games.listDefinitions()) {
    if (rooms[definition.roomType] !== undefined) {
      // The platform lobby owns a reserved room type; a game must not collide
      // with it or with another registered game.
      throw new Error(`Duplicate room type: ${definition.roomType}`);
    }
    rooms[definition.roomType] = defineRoom(definition.roomClass);
  }

  const gameServer = defineServer({
    rooms,
    transport,
    greet: false,
    gracefullyShutdown: false,
    express: (expressApp) => {
      // Colyseus 0.17's HTTP router is wired through an Express-compatible app.
      // We keep the root route unclaimed by Colyseus, then let Hono handle every
      // non-matchmaking request on the same Node HTTP server.
      expressApp.get("/", (_request: Request, _response: Response, next: NextFunction) => next());
      expressApp.use((request: Request, response: Response) => {
        honoListener(request, response);
      });
    },
  });

  return {
    app,
    httpServer,
    gameServer,
    roomDirectory,
    roomService,
    async start() {
      await gameServer.listen(deps.config.port, deps.config.host);
    },
    async stop() {
      shuttingDown = true;
      try {
        await gameServer.gracefullyShutdown(false);
      } finally {
        transport.shutdown();
        await new Promise<void>((resolve) => {
          if (httpServer.listening) {
            httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      }
    },
  };
}
