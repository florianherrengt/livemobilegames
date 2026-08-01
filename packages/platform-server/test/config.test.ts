import { computeRoomCodeClaimTtl, loadServerConfig } from "@falling-platforms/platform-server";
import { describe, expect, it } from "vitest";

describe("server config", () => {
  it("applies defaults", () => {
    const config = loadServerConfig({});
    expect(config.port).toBe(2567);
    expect(config.roomCodeLength).toBe(5);
    expect(config.maxMessagesPerSecond).toBe(60);
    expect(config.clientOrigins).toEqual([]);
    expect(config.logLevel).toBe("info");
  });

  it("parses a comma-separated origin list", () => {
    const config = loadServerConfig({
      CLIENT_ORIGINS: " http://localhost:5173 , http://localhost:5174 ",
    });
    expect(config.clientOrigins).toEqual(["http://localhost:5173", "http://localhost:5174"]);
  });

  it("computes the room code claim TTL with a safety margin", () => {
    const config = loadServerConfig({
      MAX_ROOM_LIFETIME_MS: "1000",
      FINISHED_ROOM_TIMEOUT_MS: "2000",
      RECONNECT_GRACE_MS: "3000",
    });
    expect(computeRoomCodeClaimTtl(config)).toBe(1_000 + 2_000 + 3_000 + 60_000);
  });

  it("honours an explicit claim TTL override", () => {
    const config = loadServerConfig({ ROOM_CODE_CLAIM_TTL_MS: "123456" });
    expect(computeRoomCodeClaimTtl(config)).toBe(123_456);
  });

  it("fails fast on invalid values", () => {
    expect(() => loadServerConfig({ LOG_LEVEL: "verbose" })).toThrow(
      "Invalid server configuration",
    );
    expect(() => loadServerConfig({ ROOM_CODE_LENGTH: "abc" })).toThrow("Invalid numeric value");
  });

  it("parses test-mode booleans", () => {
    const config = loadServerConfig({ E2E_TEST_MODE: "true", ALLOW_SOLO: "1" });
    expect(config.e2eTestMode).toBe(true);
    expect(config.allowSolo).toBe(true);
  });
});
