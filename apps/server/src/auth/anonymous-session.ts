import { randomUUID } from "node:crypto";
import { anonymousSessionSchema } from "@phone-party/protocol";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

import type { AppConfig } from "../config.js";
import type { AppEnv } from "../context.js";

const COOKIE_NAME = "pp_player_id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function createAnonymousSession(config: AppConfig) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // Identity comes only from a signed cookie. A tampered or missing cookie is
    // replaced with a fresh server-generated UUID; body values never reach here.
    const existing = await getSignedCookie(c, config.cookieSecret, COOKIE_NAME);
    const hasValidIdentity =
      typeof existing === "string" &&
      anonymousSessionSchema.safeParse({ playerId: existing }).success;
    const playerId = hasValidIdentity ? existing : randomUUID();

    c.set("playerId", playerId);
    await next();

    if (!hasValidIdentity) {
      await setSignedCookie(c, COOKIE_NAME, playerId, config.cookieSecret, {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.nodeEnv === "production",
        path: "/",
        maxAge: ONE_YEAR_SECONDS,
      });
    }
  });
}
