import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Playwright is plain Node tooling and does not load the repository-root .env
// by itself. Load it so a worktree's E2E_PORT is honored; an explicitly
// exported shell value still wins because loadEnvFile does not override it.
if (existsSync(`${repoRoot}/.env`)) {
  process.loadEnvFile(`${repoRoot}/.env`);
}

const PORT = Number(process.env.E2E_PORT || 3210);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm --filter @phone-party/server start",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      HOST: "127.0.0.1",
      COOKIE_SECRET: "e2e-secret-0123456789abcdefghijklmnopqrstuv",
      PUBLIC_ORIGIN: `http://127.0.0.1:${PORT}`,
      COLYSEUS_PATH: "/colyseus",
      E2E_TEST_MODE: "true",
      LOG_LEVEL: "silent",
    },
  },
});
