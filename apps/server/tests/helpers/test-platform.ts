import { randomBytes } from "node:crypto";
import { ColyseusTestServer, type ColyseusTestServer as TestServer } from "@colyseus/testing";
import { expect } from "vitest";

import { type AppConfig, loadConfig } from "../../src/config.js";
import { createGameRegistry, type GameRegistry } from "../../src/games/game-registry.js";
import { createLogger } from "../../src/logging.js";
import { createPlatformServer, type PlatformServer } from "../../src/server/create-server.js";
import { testGameDefinition } from "../fixtures/test-game-room.js";

export function createTestConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "0",
    HOST: "127.0.0.1",
    COOKIE_SECRET: "test-secret-0123456789abcdefghijklmnopqrstuv",
    PUBLIC_ORIGIN: "http://127.0.0.1:2568",
    COLYSEUS_PATH: "/colyseus",
    LOBBY_MAX_CLIENTS: "2",
    CAPITAL_PIN_TRANSITION_TIMEOUT_MS: "500",
    LOG_LEVEL: "silent",
    ...overrides,
  });
}

export type TestPlatform = {
  readonly platform: PlatformServer;
  readonly testServer: TestServer;
};

export async function createTestPlatform(
  games: GameRegistry = createGameRegistry([testGameDefinition]),
  config: AppConfig = createTestConfig(),
  roomCreationToken: string = randomBytes(32).toString("hex"),
): Promise<TestPlatform> {
  const platform = await createPlatformServer({
    config,
    games,
    logger: createLogger("silent"),
    roomCreationToken,
  });
  // Bind an OS-assigned port instead of the @colyseus/testing default so
  // concurrent worktree test processes cannot collide on the same listener.
  await platform.gameServer.listen(0, "127.0.0.1");
  const address = platform.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind a TCP port");
  }
  (platform.gameServer as unknown as { port: number }).port = address.port;
  const testServer = new ColyseusTestServer(platform.gameServer);
  // ColyseusSDK marks urlBuilder protected, but the runtime property is what the
  // web client also uses; tests need the same COLYSEUS_PATH URL building.
  const sdk = testServer.sdk as unknown as { urlBuilder: (url: URL) => string };
  sdk.urlBuilder = (url) => {
    if (url.protocol.startsWith("ws")) {
      url.pathname = `${config.colyseusPath}${url.pathname}`;
    }
    return url.toString();
  };
  return { platform, testServer };
}

export async function stopTestPlatform(test: TestPlatform | undefined): Promise<void> {
  if (test === undefined) {
    return;
  }
  await test.testServer.cleanup();
  await test.platform.stop();
}

export function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
  intervalMs = 20,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

export function cookieValue(setCookie: string | null): string | undefined {
  if (setCookie === null) {
    return undefined;
  }
  const first = setCookie.split(";")[0];
  return first;
}

export function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected a defined value");
  }
  return value;
}
