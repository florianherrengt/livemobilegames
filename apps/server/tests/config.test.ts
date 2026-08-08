import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const REQUIRED_ENV = {
  NODE_ENV: "test",
  COOKIE_SECRET: "test-secret-0123456789abcdefghijklmnopqrstuv",
} as const;

describe("server configuration", () => {
  it("uses separate safe defaults for player and address rate limits", () => {
    const config = loadConfig(REQUIRED_ENV);

    expect(config.createRoomPlayerRateLimit).toBe(10);
    expect(config.createRoomAddressRateLimit).toBe(60);
    expect(config.joinRoomPlayerRateLimit).toBe(20);
    expect(config.joinRoomAddressRateLimit).toBe(120);
  });

  it("parses explicit positive integer rate limits", () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      CREATE_ROOM_PLAYER_RATE_LIMIT: "12",
      CREATE_ROOM_ADDRESS_RATE_LIMIT: "72",
      JOIN_ROOM_PLAYER_RATE_LIMIT: "24",
      JOIN_ROOM_ADDRESS_RATE_LIMIT: "144",
    });

    expect(config.createRoomPlayerRateLimit).toBe(12);
    expect(config.createRoomAddressRateLimit).toBe(72);
    expect(config.joinRoomPlayerRateLimit).toBe(24);
    expect(config.joinRoomAddressRateLimit).toBe(144);
  });

  it.each(["0", "-1", "1.5", "100001"])("rejects an invalid rate limit %s", (value) => {
    expect(() =>
      loadConfig({
        ...REQUIRED_ENV,
        CREATE_ROOM_PLAYER_RATE_LIMIT: value,
      }),
    ).toThrow("Invalid server configuration");
  });

  it("normalises a configured Colyseus path prefix", () => {
    expect(loadConfig({ ...REQUIRED_ENV, COLYSEUS_PATH: " /socket/ " }).colyseusPath).toBe(
      "/socket",
    );
  });

  it.each(["/", "//socket", "socket", "/socket?debug=true", "/socket path"])(
    "rejects an invalid Colyseus path %s",
    (value) => {
      expect(() => loadConfig({ ...REQUIRED_ENV, COLYSEUS_PATH: value })).toThrow(
        "Invalid server configuration",
      );
    },
  );
});
