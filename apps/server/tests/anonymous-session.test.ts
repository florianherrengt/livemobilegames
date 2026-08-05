import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createAnonymousSession } from "../src/auth/anonymous-session.js";
import type { AppEnv } from "../src/context.js";
import { parsePlayerId } from "./helpers/json.js";
import { cookieValue, createTestConfig } from "./helpers/test-platform.js";

function createSessionApp() {
  const app = new Hono<AppEnv>();
  app.use("*", createAnonymousSession(createTestConfig()));
  app.get("/whoami", (c) => c.json({ playerId: c.get("playerId") }));
  app.post("/whoami", (c) => c.json({ playerId: c.get("playerId") }));
  return app;
}

describe("anonymous session", () => {
  it("creates a signed cookie for a new visitor", async () => {
    const app = createSessionApp();
    const response = await app.request("/whoami");
    expect(parsePlayerId(await response.json())).toMatch(/^[0-9a-f-]{36}$/);
    const cookie = cookieValue(response.headers.get("set-cookie"));
    expect(cookie).toContain("pp_player_id=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  });

  it("reuses a valid signed cookie", async () => {
    const app = createSessionApp();
    const first = await app.request("/whoami");
    const firstPlayerId = parsePlayerId(await first.json());
    const cookie = cookieValue(first.headers.get("set-cookie"));
    expect(cookie).toBeDefined();

    const second = await app.request("/whoami", {
      headers: { cookie: cookie as string },
    });
    expect(parsePlayerId(await second.json())).toBe(firstPlayerId);
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("replaces a tampered cookie", async () => {
    const app = createSessionApp();
    const first = await app.request("/whoami");
    const firstPlayerId = parsePlayerId(await first.json());
    const cookie = cookieValue(first.headers.get("set-cookie")) as string;
    const tampered = `${cookie.slice(0, -1)}x`;

    const second = await app.request("/whoami", {
      headers: { cookie: tampered },
    });
    expect(parsePlayerId(await second.json())).not.toBe(firstPlayerId);
    expect(second.headers.get("set-cookie")).not.toBeNull();
  });

  it("does not accept a player id from request data", async () => {
    const app = createSessionApp();
    const forgedId = randomUUID();
    const response = await app.request("/whoami", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: forgedId }),
    });
    expect(parsePlayerId(await response.json())).not.toBe(forgedId);
  });
});
