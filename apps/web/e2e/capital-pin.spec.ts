import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * Blank local style served instead of the external tile style. The test only
 * needs the map canvas and markers, not real tiles, and this keeps the suite
 * deterministic offline.
 */
const BLANK_STYLE = {
  version: 8,
  name: "e2e-blank",
  sources: {},
  layers: [],
};

async function openPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    class TrackedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols: string | string[] = []) {
        super(url, protocols);
        sockets.push(this);
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: TrackedWebSocket });
    const testWindow = window as typeof window & {
      __dropPartySocket?: () => boolean;
      __partySocketSnapshot?: () => { count: number; latestOpen: boolean };
    };
    testWindow.__dropPartySocket = () => {
      const socket = [...sockets]
        .reverse()
        .find((candidate) => candidate.readyState === NativeWebSocket.OPEN);
      if (socket === undefined) {
        return false;
      }
      socket.close();
      return true;
    };
    testWindow.__partySocketSnapshot = () => ({
      count: sockets.length,
      latestOpen: sockets.at(-1)?.readyState === NativeWebSocket.OPEN,
    });
  });
  const page = await context.newPage();
  await page.route("**/styles/positron*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      json: BLANK_STYLE,
    }),
  );
  return page;
}

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.locator("#create-player-name").fill(name);
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: 15_000 });
  return (await page.getByTestId("room-code").textContent())?.trim() ?? "";
}

async function joinRoom(page: Page, name: string, code: string): Promise<void> {
  await page.goto("/");
  await page.locator("#room-code").fill(code.toLowerCase());
  await page.locator("#join-player-name").fill(name);
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByTestId("room-code")).toHaveText(code, { timeout: 15_000 });
}

async function dropPin(page: Page): Promise<void> {
  const box = await page.locator(".cp-map-container").boundingBox();
  if (!box) {
    throw new Error("round map has no bounding box");
  }
  await page
    .locator(".cp-map-container")
    .tap({ position: { x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) } });
  await expect(page.getByRole("button", { name: "Lock answer" })).toBeEnabled();
}

async function dropSocketAndObserveReconnect(page: Page): Promise<void> {
  const beforeSocketCount = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __partySocketSnapshot?: () => { count: number; latestOpen: boolean };
        }
      ).__partySocketSnapshot?.().count ?? 0,
  );
  const dropped = await page.evaluate(
    () =>
      (window as typeof window & { __dropPartySocket?: () => boolean }).__dropPartySocket?.() ??
      false,
  );
  expect(dropped).toBe(true);
  await page.waitForFunction(
    (previousCount) => {
      const snapshot = (
        window as typeof window & {
          __partySocketSnapshot?: () => { count: number; latestOpen: boolean };
        }
      ).__partySocketSnapshot?.();
      return snapshot !== undefined && snapshot.count > previousCount && snapshot.latestOpen;
    },
    beforeSocketCount,
    { timeout: 10_000 },
  );
}

test("two phones play all ten Capital Pin rounds, reconnect, finish, and rematch", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(alice.getByText("Alice (you)", { exact: true })).toBeVisible();
  await expect(bob.getByText("Bob (you)", { exact: true })).toBeVisible();

  // Host selects Capital Pin and starts once: the transition and the first
  // round begin automatically when every roster player has arrived.
  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Capital Pin" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await alice.locator(".cp-map-container").waitFor({ timeout: 15_000 });
  await bob.locator(".cp-map-container").waitFor({ timeout: 15_000 });
  for (let round = 1; round <= 10; round++) {
    for (const page of [alice, bob]) {
      await expect(page.getByText(`Round ${round} / 10`)).toBeVisible({ timeout: 15_000 });
      await page.locator(".cp-map-container").waitFor({ timeout: 15_000 });
    }

    const aliceCapital = ((await alice.locator('[aria-live="polite"]').textContent()) ?? "").trim();
    const bobCapital = ((await bob.locator('[aria-live="polite"]').textContent()) ?? "").trim();
    expect(aliceCapital).not.toBe("");
    expect(bobCapital).toBe(aliceCapital);

    // By round four the room is beyond Colyseus' minimum reconnect uptime.
    // Drop Bob's real game socket and verify the same browser resumes the
    // active round before either player submits.
    if (round === 4) {
      await dropSocketAndObserveReconnect(bob);
      await expect(bob.getByText("Round 4 / 10")).toBeVisible({ timeout: 10_000 });
      await expect(bob.getByRole("button", { name: "Lock answer" })).toBeDisabled();
    }

    await dropPin(alice);
    await dropPin(bob);
    await alice.getByRole("button", { name: "Lock answer" }).tap();
    await bob.getByRole("button", { name: "Lock answer" }).tap();

    // Both phones submit the same map point, so they tie every round and see
    // the same authoritative reveal before advancing.
    for (const page of [alice, bob]) {
      await expect(page.getByText(`Round ${round}: ${aliceCapital}`)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator(".cp-map-container .maplibregl-canvas")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator(".cp-pin-marker")).toHaveCount(3, { timeout: 15_000 });
      await expect(page.getByText("winner")).toHaveCount(2);
    }
  }

  for (const page of [alice, bob]) {
    await expect(page.getByRole("heading", { name: "Game over" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
    await expect(page.getByText("Alice")).toBeVisible();
    await expect(page.getByText("Bob")).toBeVisible();
    await expect(page.getByText("10 wins")).toHaveCount(2);
  }
  await expect(bob.getByRole("button", { name: "Waiting for the host…" })).toBeDisabled();

  // The final standings stay usable at the 320px minimum width.
  for (const page of [alice, bob]) {
    await page.setViewportSize({ width: 320, height: 568 });
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noHorizontalScroll).toBe(true);
  }

  await alice.getByRole("button", { name: "Play again" }).tap();
  for (const page of [alice, bob]) {
    await expect(page.getByText("Round 1 / 10")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".cp-map-container")).toBeVisible();
  }

  await Promise.all([alice.context().close(), bob.context().close()]);
});
