import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { ZodError } from "zod";

import { createAnonymousSession } from "./auth/anonymous-session.js";
import type { AppConfig } from "./config.js";
import type { AppEnv } from "./context.js";
import { AppError } from "./errors.js";
import type { GameRegistry } from "./games/game-registry.js";
import type { Logger } from "./logging.js";
import type { RoomService } from "./rooms/room-service.js";
import { createRoomRoutes } from "./routes/rooms.js";
import { formatZodIssues } from "./routes/validation.js";

const webDistPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web/dist",
);

export type AppDeps = {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly roomService: RoomService;
  readonly registry: GameRegistry;
};

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const colyseusPath = deps.config.colyseusPath.replace(/\/$/, "");

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use("*", requestLogger(deps.logger));
  app.use("/api/*", bodyLimit({ maxSize: 16 * 1024 }));
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  const anonymousSession = createAnonymousSession(deps.config);
  app.use("/api/games", anonymousSession);
  app.use("/api/rooms/*", anonymousSession);

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/games", (c) => c.json({ games: deps.registry.listManifests() }));
  app.route(
    "/",
    createRoomRoutes({
      roomService: deps.roomService,
      createRoomLimiter: new RateLimiterMemory({
        points: 10,
        duration: 60,
        keyPrefix: "create-room",
      }),
      joinRoomLimiter: new RateLimiterMemory({
        points: 20,
        duration: 60,
        keyPrefix: "join-room",
      }),
    }),
  );

  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  if (existsSync(webDistPath)) {
    app.use("/assets/*", serveStatic({ root: webDistPath }));
  }

  app.notFound((c) => {
    if (
      c.req.path.startsWith("/api") ||
      c.req.path.startsWith("/assets/") ||
      c.req.path.startsWith(colyseusPath)
    ) {
      // API, missing static assets, and Colyseus paths must never fall back to
      // the SPA entry point: a missing asset should 404, and WebSocket/HTTP
      // traffic under /colyseus must not receive an HTML document.
      return c.json(
        {
          error: { code: "NOT_FOUND", message: "Not found" },
        },
        404,
      );
    }
    if (hasWebDist) {
      return serveIndex(c);
    }
    return c.json(
      {
        error: { code: "NOT_FOUND", message: "Not found" },
      },
      404,
    );
  });

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details !== undefined ? { details: error.details } : {}),
          },
        },
        error.status,
      );
    }
    if (error instanceof ZodError) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid request",
            details: formatZodIssues(error),
          },
        },
        400,
      );
    }
    if (error instanceof HTTPException) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: error.message,
          },
        },
        error.status,
      );
    }
    deps.logger.error({ err: error, requestId: c.get("requestId") }, "unhandled error");
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      },
      500,
    );
  });

  return app;
}

const hasWebDist = webDistPath !== "" && existsSync(webDistPath);

function serveIndex(c: Context<AppEnv>) {
  const indexHtml = readFileSync(path.join(webDistPath, "index.html"), "utf8");
  c.header("Cache-Control", "no-cache");
  return c.html(indexHtml);
}

function requestLogger(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const startedAt = performance.now();
    await next();
    logger.info(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "request",
    );
  });
}
