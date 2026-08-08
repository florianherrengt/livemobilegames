import { zValidator } from "@hono/zod-validator";
import { createRoomRequestSchema, joinRoomRequestSchema } from "@phone-party/protocol";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { RateLimiterMemory } from "rate-limiter-flexible";
import { z } from "zod";

import type { AppEnv } from "../context.js";
import { AppError } from "../errors.js";
import type { RoomService } from "../rooms/room-service.js";
import { invalidRequestResponse } from "./validation.js";

const joinRoomParamsSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/i, "Invalid room code"),
});

export type RoomRoutesDeps = {
  readonly roomService: RoomService;
  readonly createRoomPlayerLimiter: RateLimiterMemory;
  readonly createRoomAddressLimiter: RateLimiterMemory;
  readonly joinRoomPlayerLimiter: RateLimiterMemory;
  readonly joinRoomAddressLimiter: RateLimiterMemory;
};

export function createRoomRoutes(deps: RoomRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(
    "/api/rooms",
    rateLimit(deps.createRoomPlayerLimiter, deps.createRoomAddressLimiter),
    zValidator("json", createRoomRequestSchema, (result, c) => {
      if (!result.success) {
        return invalidRequestResponse(c, result.error);
      }
      return undefined;
    }),
    async (c) => {
      const input = c.req.valid("json");
      const playerId = c.get("playerId");
      const result = await deps.roomService.createRoom({
        playerId,
        playerName: input.playerName,
      });
      return c.json(result, 201);
    },
  );

  app.post(
    "/api/rooms/:code/join",
    rateLimit(deps.joinRoomPlayerLimiter, deps.joinRoomAddressLimiter),
    zValidator("param", joinRoomParamsSchema, (result, c) => {
      if (!result.success) {
        return invalidRequestResponse(c, result.error);
      }
      return undefined;
    }),
    zValidator("json", joinRoomRequestSchema, (result, c) => {
      if (!result.success) {
        return invalidRequestResponse(c, result.error);
      }
      return undefined;
    }),
    async (c) => {
      const params = c.req.valid("param");
      const input = c.req.valid("json");
      const playerId = c.get("playerId");
      const result = await deps.roomService.joinRoom({
        roomCode: params.code,
        playerId,
        playerName: input.playerName,
      });
      return c.json(result);
    },
  );

  return app;
}

export function rateLimit(playerLimiter: RateLimiterMemory, addressLimiter: RateLimiterMemory) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // Use the socket address instead of x-forwarded-for: blindly trusting proxy
    // headers would let a client fake the address bucket. Player and address
    // limits must be independent; a composite key can be bypassed by omitting
    // the anonymous cookie and receiving a fresh signed player ID each time.
    const remoteAddress = c.env?.incoming?.socket.remoteAddress;
    const ip = remoteAddress?.replace(/^::ffff:/, "") ?? "local";
    try {
      await Promise.all([playerLimiter.consume(c.get("playerId")), addressLimiter.consume(ip)]);
    } catch {
      throw new AppError("RATE_LIMITED", 429, "Too many requests");
    }
    await next();
  });
}
