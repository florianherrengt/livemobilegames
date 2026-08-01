import { platformCenterX, platformCenterY, TILE_PITCH } from "@falling-platforms/shared";
import { type Browser, expect, type Page, test } from "@playwright/test";

const GAME_WIDTH = 390;
const CAMERA_ZOOM = GAME_WIDTH / (TILE_PITCH * 7);

async function openPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  return context.newPage();
}

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto("/falling-platforms/");
  await page.locator("#name-input").fill(name);
  await page.locator("#create-button").tap();
  await expect(page.locator("#lobby-code")).not.toBeEmpty({ timeout: 15_000 });
  return (await page.locator("#lobby-code").textContent()) ?? "";
}

async function joinRoom(page: Page, name: string, code: string): Promise<void> {
  await page.goto("/falling-platforms/");
  await page.locator("#name-input").fill(name);
  await page.locator("#code-input").fill(code);
  await page.locator("#join-button").tap();
  await expect(page.locator("#lobby-code")).toHaveText(code, { timeout: 15_000 });
}

async function waitForPlayers(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (expected) => document.querySelectorAll("#player-list .player-row").length === expected,
    count,
    { timeout: 15_000 },
  );
}

async function dataset(page: Page, key: string): Promise<string | undefined> {
  return page.evaluate((name) => {
    return document.querySelector("#app")?.getAttribute(`data-${name}`) ?? undefined;
  }, key);
}

async function screenPosition(
  page: Page,
  gridX: number,
  gridY: number,
  arenaSide: number,
): Promise<{ x: number; y: number }> {
  const canvas = page.locator("#game-container canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("game canvas has no bounding box");
  }
  const scale = box.width / GAME_WIDTH;
  const scroll = await page.evaluate(() => {
    const raw = document.querySelector("#app")?.getAttribute("data-camera-scroll");
    if (!raw) {
      return undefined;
    }
    const [scrollX, scrollY] = raw.split(",").map(Number);
    return { scrollX, scrollY };
  });
  if (!scroll) {
    throw new Error("data-camera-scroll is not available yet");
  }
  const worldX = platformCenterX(gridX, arenaSide);
  const worldY = platformCenterY(gridY, arenaSide);
  return {
    x: box.x + (worldX - scroll.scrollX) * CAMERA_ZOOM * scale,
    y: box.y + (worldY - scroll.scrollY) * CAMERA_ZOOM * scale,
  };
}

/** Drags from one platform centre to another: a swipe-to-hop gesture. */
async function swipeBetween(
  page: Page,
  from: { gridX: number; gridY: number },
  to: { gridX: number; gridY: number },
  arenaSide: number,
): Promise<void> {
  // Wait for the camera scroll to settle so the screen mapping is exact.
  let previous: string | undefined;
  for (let i = 0; i < 20; i++) {
    const current =
      (await page.evaluate(() =>
        document.querySelector("#app")?.getAttribute("data-camera-scroll"),
      )) ?? undefined;
    if (previous && current === previous) {
      break;
    }
    previous = current;
    await page.waitForTimeout(50);
  }
  const start = await screenPosition(page, from.gridX, from.gridY, arenaSide);
  const end = await screenPosition(page, to.gridX, to.gridY, arenaSide);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

test("two phones play a full deterministic round and a second round", async ({ browser }) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  // Alice creates a private room.
  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);

  // Bob joins with the room code.
  await joinRoom(bob, "Bob", code);

  // Both see the same lobby with two players; only the host sees Start.
  await waitForPlayers(alice, 2);
  await waitForPlayers(bob, 2);
  await expect(alice.locator("#start-button")).toBeVisible();
  await expect(bob.locator("#start-button")).toBeHidden();

  // Host starts the match; both phones reach the arena.
  await alice.locator("#start-button").tap();
  await alice.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });
  await bob.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });
  expect(await dataset(alice, "arena-side")).toBe("7");
  expect(await dataset(alice, "alive-count")).toBe("2");
  expect(await dataset(alice, "local-platform")).toBe("3:3");
  expect(await dataset(bob, "local-platform")).toBe("3:4");

  // Alice swipes right from her tile (3:3 -> 4:3).
  const arenaSide = Number(await dataset(alice, "arena-side"));
  await swipeBetween(alice, { gridX: 3, gridY: 3 }, { gridX: 4, gridY: 3 }, arenaSide);
  // The local player starts moving immediately (authoritative jumping flag).
  await alice.waitForFunction(
    () => document.querySelector("#app")?.getAttribute("data-local-jumping") === "true",
    undefined,
    { timeout: 5_000 },
  );
  await alice.waitForFunction(
    () => document.querySelector("#app")?.getAttribute("data-local-platform") === "4:3",
    undefined,
    { timeout: 10_000 },
  );

  // The second phone sees Alice move to the same authoritative platform.
  await bob.waitForFunction(
    () => {
      const raw = document.querySelector("#app")?.getAttribute("data-players");
      if (!raw) {
        return false;
      }
      const players: Array<{ name: string; currentPlatformId: string }> = JSON.parse(raw);
      return players.find((player) => player.name === "Alice")?.currentPlatformId === "4:3";
    },
    undefined,
    { timeout: 10_000 },
  );

  // Bob's spawn is the deterministic first removal target: it warns on both phones.
  await alice.waitForFunction(
    () => Number(document.querySelector("#app")?.getAttribute("data-warning-count") ?? "0") > 0,
    undefined,
    { timeout: 10_000 },
  );
  await bob.waitForFunction(
    () => Number(document.querySelector("#app")?.getAttribute("data-warning-count") ?? "0") > 0,
    undefined,
    { timeout: 10_000 },
  );

  // Bob stands still, his platform disappears and he is eliminated into spectating.
  await bob.waitForSelector('#app[data-spectating="true"]', { timeout: 15_000 });
  await alice.waitForFunction(
    () => document.querySelector("#app")?.getAttribute("data-alive-count") === "1",
    undefined,
    { timeout: 15_000 },
  );

  // Alice wins; both phones show the result.
  await alice.waitForSelector('#app[data-phase="results"]', { timeout: 15_000 });
  await bob.waitForSelector('#app[data-phase="results"]', { timeout: 15_000 });
  await expect(alice.locator("#results-text")).toContainText("Alice wins!");
  expect(await dataset(alice, "draw")).toBe("false");
  expect(await dataset(alice, "winner-session-id")).not.toBe("");

  // Both return to the same lobby.
  await alice.waitForSelector('#app[data-phase="lobby"]', { timeout: 20_000 });
  await bob.waitForSelector('#app[data-phase="lobby"]', { timeout: 20_000 });
  await waitForPlayers(alice, 2);
  await waitForPlayers(bob, 2);

  // A second round can be started.
  await alice.locator("#start-button").tap();
  await alice.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });
  await bob.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });
  expect(await dataset(alice, "alive-count")).toBe("2");

  await alice.close();
  await bob.close();
});

test("shows a clear error when joining a room that does not exist", async ({ browser }) => {
  const page = await openPhone(browser);
  await page.goto("/falling-platforms/");
  await page.locator("#name-input").fill("Lonely");
  await page.locator("#code-input").fill("ZZZZZ");
  await page.locator("#join-button").tap();
  await expect(page.locator("#home-error")).toBeVisible({ timeout: 15_000 });
  await page.close();
});

test("invite link auto-joins visitors and shows a QR code", async ({ browser }) => {
  const alice = await openPhone(browser);
  const code = await createRoom(alice, "Alice");

  // The lobby shows a shareable invite URL and a QR code for it.
  const inviteUrlInput = alice.locator("#invite-url");
  await expect(inviteUrlInput).not.toHaveValue("");
  const inviteUrl = await inviteUrlInput.inputValue();
  expect(inviteUrl).toContain(`code=${code}`);
  await expect(alice.locator("#invite-qr canvas")).toBeVisible({ timeout: 10_000 });

  // A visitor with a saved name joins automatically from the invite link.
  const bobContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await bobContext.addInitScript((savedName) => {
    localStorage.setItem("falling-platforms-name", savedName);
  }, "Bob");
  const bob = await bobContext.newPage();
  await bob.goto(inviteUrl);
  await expect(bob.locator("#lobby-code")).toHaveText(code, { timeout: 15_000 });
  await waitForPlayers(alice, 2);
  await waitForPlayers(bob, 2);

  // A visitor without a saved name gets the code pre-filled and a hint.
  const strangerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const stranger = await strangerContext.newPage();
  await stranger.goto(inviteUrl);
  await expect(stranger.locator("#home-hint")).toContainText(code);
  await expect(stranger.locator("#code-input")).toHaveValue(code);

  await alice.close();
  await bob.close();
  await stranger.close();
});

test("recovers from a dropped connection and regains control", async ({ browser }) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  await joinRoom(bob, "Bob", code);
  await waitForPlayers(alice, 2);
  await waitForPlayers(bob, 2);
  await alice.locator("#start-button").tap();
  await alice.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });
  await bob.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });

  // A hop works before the drop.
  const arenaSide = Number(await dataset(alice, "arena-side"));
  await swipeBetween(alice, { gridX: 3, gridY: 3 }, { gridX: 4, gridY: 3 }, arenaSide);
  await alice.waitForFunction(
    () => document.querySelector("#app")?.getAttribute("data-local-platform") === "4:3",
    undefined,
    { timeout: 10_000 },
  );

  // Drop Alice's network: the client shows the reconnecting indicator and must
  // NOT bounce to the home screen.
  await alice.context().setOffline(true);
  await expect(alice.locator("#hud-reconnecting")).toBeVisible({ timeout: 5_000 });
  await expect(alice.locator("#home-screen")).toBeHidden();

  // Bring the network back; the SDK auto-reconnects inside the server grace.
  await alice.context().setOffline(false);
  await expect(alice.locator("#hud-reconnecting")).toBeHidden({ timeout: 15_000 });
  await expect(alice.locator("#home-screen")).toBeHidden();

  // Server-driven patches resume: Alice's phone sees the match reach results.
  await alice.waitForSelector('#app[data-phase="results"]', { timeout: 20_000 });
  await alice.waitForSelector('#app[data-phase="lobby"]', { timeout: 25_000 });

  // A second round starts and Alice's input is fully restored.
  await alice.locator("#start-button").tap();
  await alice.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });
  const roundTwoSide = Number(await dataset(alice, "arena-side"));
  await swipeBetween(alice, { gridX: 3, gridY: 3 }, { gridX: 4, gridY: 3 }, roundTwoSide);
  await alice.waitForFunction(
    () => document.querySelector("#app")?.getAttribute("data-local-platform") === "4:3",
    undefined,
    { timeout: 10_000 },
  );

  await alice.close();
  await bob.close();
});
