import { defineConfig } from "@playwright/test";

const E2E_PORT = 2572;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
  },
  webServer: {
    command: "pnpm --filter @falling-platforms/server start",
    url: `http://127.0.0.1:${E2E_PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: String(E2E_PORT),
      HOST: "127.0.0.1",
      E2E_TEST_MODE: "true",
      ALLOW_SOLO: "true",
    },
  },
});
