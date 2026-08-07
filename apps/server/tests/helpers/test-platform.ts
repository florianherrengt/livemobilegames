import { randomBytes } from "node:crypto";
import { ColyseusTestServer } from "@colyseus/testing";
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
  readonly testServer: ColyseusTestServer;
};

export async function createTestPlatform(
  games: GameRegistry = createGameRegistry([testGameDefinition]),
  config: AppConfig = createTestConfig(),
  roomCreationToken: string = randomBytes(32).toString("hex"),
  testPort = Number(process.env.TEST_SERVER_PORT ?? 2568),
): Promise<TestPlatform> {
  if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535) {
    throw new Error(`Invalid TEST_SERVER_PORT: ${testPort}`);
  }
  const platform = await createPlatformServer({
    config,
    games,
    logger: createLogger("silent"),
    roomCreationToken,
  });
  let rejectListenError: ((error: Error) => void) | undefined;
  const listenError = new Promise<never>((_, reject) => {
    rejectListenError = reject;
  });
  const onListenError = (error: Error): void => {
    rejectListenError?.(error);
  };
  platform.httpServer.once("error", onListenError);
  const testServer = await Promise.race([
    (async () => {
      // @colyseus/testing's boot() always listens on its hardcoded default
      // port when given a Server instance. Listening directly keeps the port
      // overridable so multiple worktrees can run integration suites on one
      // machine without colliding.
      await platform.gameServer.listen(testPort);
      return new ColyseusTestServer(platform.gameServer);
    })(),
    listenError,
  ]);
  platform.httpServer.off("error", onListenError);
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
