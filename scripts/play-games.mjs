#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WEB_PORT = 5173;
const SETUP_TIMEOUT_MS = 15_000;
const GAME_START_TIMEOUT_MS = 30_000;

const USAGE = `Usage: pnpm play [options]

Opens two headed, phone-emulated Chromium windows and starts a two-player game
using the dev server that must already be running on WEB_PORT (default 5173).

Options:
  --game <id>   Game id from the running catalogue (default: pong)
  --help        Show this help`;

// Marker locators that prove a game room has replaced the lobby. Most games
// expose a dedicated arena testid; Capital Pin and Live Drawing & Guessing use
// their own early-game surfaces.
const GAME_START_MARKERS = {
  "capital-pin": [
    { kind: "text", value: "How to play Capital Pin" },
    { kind: "css", value: ".cp-map-container" },
  ],
  "coin-rush": [{ kind: "testid", value: "coin-rush-arena" }],
  "falling-platforms": [{ kind: "testid", value: "falling-platforms-arena" }],
  "flappy-race": [{ kind: "testid", value: "flappy-race-arena" }],
  golf: [{ kind: "testid", value: "golf-race-arena" }],
  "kart-racing": [{ kind: "testid", value: "kart-racing-arena" }],
  "live-drawing-guessing": [
    { kind: "testid", value: "ldg-drawer-word" },
    { kind: "testid", value: "ldg-guess-input" },
  ],
  "memory-path": [{ kind: "testid", value: "memory-path-arena" }],
  pong: [{ kind: "testid", value: "pong-arena" }],
};

function parseArgs(argv) {
  const options = { gameId: "pong" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    }
    if (arg === "--game") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error("Missing value for --game");
        console.error(USAGE);
        process.exit(1);
      }
      options.gameId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      console.error(USAGE);
      process.exit(1);
    }
    console.error(`Unexpected argument: ${arg}`);
    console.error(USAGE);
    process.exit(1);
  }

  return options;
}

function loadWebPort() {
  const envPath = path.join(repoRoot, ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const raw = process.env.WEB_PORT ?? String(DEFAULT_WEB_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`WEB_PORT must be a port from 1 to 65535, got ${raw}`);
    process.exit(1);
  }
  return port;
}

async function verifyDevServer(webPort) {
  const origins = [`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`];
  for (const origin of origins) {
    try {
      const rootResponse = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5_000) });
      if (!rootResponse.ok) {
        throw new Error(`GET ${origin}/ returned ${rootResponse.status}`);
      }
      const healthResponse = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!healthResponse.ok) {
        throw new Error(`GET ${origin}/api/health returned ${healthResponse.status}`);
      }
      return origin;
    } catch {
      // Try the next host; Vite defaults to localhost and may bind IPv6 only.
    }
  }
  console.error(
    `Start \`pnpm dev\` first: ${origins.join(" or ")} did not respond on both / and /api/health.`,
  );
  process.exit(1);
}

async function loadGames(origin) {
  const response = await fetch(`${origin}/api/games`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    console.error(`Could not load the game catalogue: GET /api/games returned ${response.status}`);
    process.exit(1);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.games)) {
    console.error("Could not load the game catalogue: /api/games returned an unexpected shape");
    process.exit(1);
  }
  return payload.games;
}

function resolveGame(games, gameId) {
  const game = games.find((candidate) => candidate.id === gameId);
  if (game === undefined) {
    console.error(`Unknown game: ${gameId}`);
    console.error("Available games:");
    for (const candidate of games) {
      console.error(`  ${candidate.id.padEnd(24)} ${candidate.name}`);
    }
    process.exit(1);
  }
  return game;
}

async function openPhone(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  return context.newPage();
}

async function createRoom(page, origin, name) {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.locator("#create-player-name").fill(name);
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="room-code"]');
      return element !== null && element.textContent?.trim() !== "";
    },
    undefined,
    { timeout: SETUP_TIMEOUT_MS },
  );
  return (await page.getByTestId("room-code").textContent())?.trim() ?? "";
}

async function joinRoom(page, origin, code, name) {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.locator("#room-code").fill(code.toLowerCase());
  await page.locator("#join-player-name").fill(name);
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await page.waitForFunction(
    (expectedCode) => {
      const element = document.querySelector('[data-testid="room-code"]');
      return element?.textContent?.trim() === expectedCode;
    },
    code,
    { timeout: SETUP_TIMEOUT_MS },
  );
}

async function waitForPlayers(page) {
  await page
    .getByRole("heading", { name: /Players \(2\)/ })
    .waitFor({ state: "visible", timeout: SETUP_TIMEOUT_MS });
}

async function selectGame(page, game) {
  await page.getByRole("combobox", { name: "Choose a game" }).click({ timeout: SETUP_TIMEOUT_MS });
  await page
    .getByRole("option", { name: game.name, exact: true })
    .click({ timeout: SETUP_TIMEOUT_MS });
}

function markerLocator(page, marker) {
  if (marker.kind === "testid") {
    return page.getByTestId(marker.value);
  }
  if (marker.kind === "text") {
    return page.getByText(marker.value, { exact: true });
  }
  return page.locator(marker.value);
}

async function waitForGameStart(page, game) {
  await page
    .getByRole("button", { name: "Start game", exact: true })
    .waitFor({ state: "detached", timeout: GAME_START_TIMEOUT_MS });
  await page
    .getByRole("button", { name: "Waiting for the host…", exact: true })
    .waitFor({ state: "detached", timeout: GAME_START_TIMEOUT_MS });

  const markers = GAME_START_MARKERS[game.id];
  if (markers === undefined) {
    throw new Error(`No start marker configured for game ${game.id}`);
  }
  await Promise.race(
    markers.map((marker) =>
      markerLocator(page, marker).waitFor({
        state: "visible",
        timeout: GAME_START_TIMEOUT_MS,
      }),
    ),
  );
}

async function printPageStates(pages) {
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    try {
      const url = page.url();
      const body = await page.locator("body").innerText({ timeout: 2_000 });
      console.error(`\nPage ${index + 1} (${url}):\n${body.slice(0, 800)}`);
    } catch {
      console.error(`\nPage ${index + 1}: could not read page state`);
    }
  }
}

const { gameId } = parseArgs(process.argv.slice(2));
const webPort = loadWebPort();
const pages = [];
let browser;

async function closeBrowser() {
  if (browser !== undefined) {
    await browser.close().catch(() => {});
    browser = undefined;
  }
}

process.once("SIGINT", () => {
  console.log("\nClosing browser windows…");
  void closeBrowser().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  console.log("\nClosing browser windows…");
  void closeBrowser().finally(() => process.exit(0));
});

async function main() {
  const origin = await verifyDevServer(webPort);
  const games = await loadGames(origin);
  const game = resolveGame(games, gameId);

  const executablePath = chromium.executablePath();
  if (!existsSync(executablePath)) {
    console.error("Playwright Chromium is not installed.");
    console.error("Run:\n\n  pnpm exec playwright install chromium\n");
    process.exit(1);
  }

  browser = await chromium.launch({ headless: false });
  const alice = await openPhone(browser);
  pages.push(alice);
  const bob = await openPhone(browser);
  pages.push(bob);

  const code = await createRoom(alice, origin, "Alice");
  await joinRoom(bob, origin, code, "Bob");
  await Promise.all([waitForPlayers(alice), waitForPlayers(bob)]);

  await selectGame(alice, game);
  await alice.getByRole("button", { name: "Start game", exact: true }).click();
  await Promise.all([waitForGameStart(alice, game), waitForGameStart(bob, game)]);

  console.log(`Game started: ${game.name} — Alice (host) and Bob are in ${code}. Ctrl+C to quit.`);
  await new Promise(() => {});
}

main().catch(async (error) => {
  await printPageStates(pages);
  console.error(error instanceof Error ? error.stack : String(error));
  await closeBrowser();
  process.exitCode = 1;
});
