import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CapitalPinCommand,
  CapitalPinPlayerState,
  CapitalPinState,
} from "@falling-platforms/capital-pin";
import { createCapitalPinGame } from "@falling-platforms/capital-pin/server";
import {
  computeRoomCodeClaimTtl,
  createPlatformLogger,
  loadServerConfig,
  PlatformRoom,
} from "@falling-platforms/platform-server";
import type {
  FallingPlatformsCommand,
  FallingPlatformsPlayerState,
  FallingPlatformsState,
} from "@falling-platforms/shared";
import type { TapRaceCommand, TapRacePlayerState, TapRaceState } from "@falling-platforms/tap-race";
import { createTapRaceGame } from "@falling-platforms/tap-race/server";
import { defineRoom, defineServer, WebSocketTransport } from "colyseus";
import express from "express";

import { createFallingPlatformsGame } from "./games/falling-platforms.js";

export const serverConfig = loadServerConfig();
const logger = createPlatformLogger(serverConfig.logLevel);

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDist = path.resolve(packageDir, "../client/dist");
const tapRaceClientDist = path.resolve(packageDir, "../tap-race-client/dist");
const capitalPinClientDist = path.resolve(packageDir, "../capital-pin-client/dist");
const hubClientDist = path.resolve(packageDir, "../hub-client/dist");

const platformRoomOptions = {
  roomCodeLength: serverConfig.roomCodeLength,
  roomCodeClaimTtlMs: computeRoomCodeClaimTtl(serverConfig),
  maxMessagesPerSecond: serverConfig.maxMessagesPerSecond,
  finishedRoomTimeoutMs: serverConfig.finishedRoomTimeoutMs,
  maxRoomLifetimeMs: serverConfig.maxRoomLifetimeMs,
  now: () => Date.now(),
  logger,
  queueWarnDepth: serverConfig.queueWarnDepth,
  queueWarnDurationMs: serverConfig.queueWarnDurationMs,
};

const gameRegistrations = [
  {
    id: "falling_platforms",
    create: () =>
      createFallingPlatformsGame({
        allowSolo: serverConfig.allowSolo,
        e2eMode: serverConfig.e2eTestMode,
        reconnectGraceMs: serverConfig.reconnectGraceMs,
      }),
  },
  {
    id: "tap_race",
    create: () =>
      createTapRaceGame({
        e2eMode: serverConfig.e2eTestMode,
        reconnectGraceMs: serverConfig.reconnectGraceMs,
      }),
  },
  {
    id: "capital_pin",
    create: () =>
      createCapitalPinGame({
        e2eMode: serverConfig.e2eTestMode,
        reconnectGraceMs: serverConfig.reconnectGraceMs,
      }),
  },
] as const;

class FallingPlatformsRoom extends PlatformRoom<
  FallingPlatformsState,
  FallingPlatformsPlayerState,
  FallingPlatformsCommand
> {
  constructor() {
    const registration = gameRegistrations[0];
    if (!registration) {
      throw new Error("Falling Platforms game is not registered");
    }
    super(registration.create(), platformRoomOptions);
  }
}

class TapRaceRoom extends PlatformRoom<TapRaceState, TapRacePlayerState, TapRaceCommand> {
  constructor() {
    const registration = gameRegistrations[1];
    if (registration?.id !== "tap_race") {
      throw new Error("Tap Race game is not registered");
    }
    super(registration.create(), platformRoomOptions);
  }
}

class CapitalPinRoom extends PlatformRoom<
  CapitalPinState,
  CapitalPinPlayerState,
  CapitalPinCommand
> {
  constructor() {
    const registration = gameRegistrations[2];
    if (registration?.id !== "capital_pin") {
      throw new Error("Capital Pin game is not registered");
    }
    super(registration.create(), platformRoomOptions);
  }
}

const allowedOrigins = serverConfig.clientOrigins;

function originAllowed(origin: string | undefined): boolean {
  if (allowedOrigins.length === 0) {
    return true;
  }
  return origin !== undefined && allowedOrigins.includes(origin);
}

export const appConfig = defineServer({
  rooms: {
    falling_platforms: defineRoom(FallingPlatformsRoom),
    tap_race: defineRoom(TapRaceRoom),
    capital_pin: defineRoom(CapitalPinRoom),
  },
  transport: new WebSocketTransport({
    maxPayload: serverConfig.maxSocketPayloadBytes,
    verifyClient: (info, callback) => {
      const origin = typeof info.origin === "string" ? info.origin : undefined;
      if (originAllowed(origin)) {
        callback(true);
      } else {
        callback(false, 403, "Origin not allowed");
      }
    },
  }),
  express: (app) => {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && originAllowed(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      }
      next();
    });

    app.use("/tap-race", express.static(tapRaceClientDist, { index: "index.html" }));
    app.use("/capital-pin", express.static(capitalPinClientDist, { index: "index.html" }));
    app.use("/falling-platforms", express.static(clientDist, { index: "index.html" }));
    // The hub is the root landing page; it links into each independent client.
    app.use(express.static(hubClientDist, { index: "index.html" }));

    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });

    app.get("/games", (_req, res) => {
      res.json({
        games: gameRegistrations.map((registration) => {
          const game = registration.create();
          return {
            id: game.id,
            minPlayers: game.config.minPlayers,
            maxPlayers: game.config.maxPlayers,
            requiresReady: game.config.requiresReady,
            allowJoinAfterStart: game.config.allowJoinAfterStart,
          };
        }),
      });
    });
  },
});
