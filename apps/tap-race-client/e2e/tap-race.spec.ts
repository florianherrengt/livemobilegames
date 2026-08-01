import { type Browser, expect, type Page, test } from "@playwright/test";

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
  await page.goto("/tap-race/");
  await page.locator("#name-input").fill(name);
  await page.locator("#create-button").tap();
  await expect(page.locator("#lobby-code")).not.toBeEmpty({ timeout: 15_000 });
  return (await page.locator("#lobby-code").textContent()) ?? "";
}

async function joinRoom(page: Page, name: string, code: string): Promise<void> {
  await page.goto("/tap-race/");
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

test("two phones play a full Tap Race round and play again", async ({ browser }) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  await joinRoom(bob, "Bob", code);
  await waitForPlayers(alice, 2);
  await waitForPlayers(bob, 2);

  // Both mark themselves ready; only the host can start.
  await alice.locator("#ready-button").tap();
  await bob.locator("#ready-button").tap();
  await expect(alice.locator("#start-button")).toBeEnabled({ timeout: 10_000 });
  await expect(bob.locator("#start-button")).toBeDisabled();

  await alice.locator("#start-button").tap();
  await alice.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });
  await bob.waitForSelector('#app[data-phase="playing"]', { timeout: 15_000 });

  // Both tap; scores update live on both phones.
  for (let index = 0; index < 5; index++) {
    await alice.locator("#tap-button").tap();
  }
  for (let index = 0; index < 2; index++) {
    await bob.locator("#tap-button").tap();
  }
  await expect(alice.locator('#score-list [data-score="5"]')).toBeVisible({ timeout: 10_000 });
  await expect(bob.locator('#score-list [data-score="2"]')).toBeVisible({ timeout: 10_000 });

  // The server timer ends the match; both see the leaderboard.
  await alice.waitForSelector('#app[data-phase="finished"]', { timeout: 20_000 });
  await bob.waitForSelector('#app[data-phase="finished"]', { timeout: 20_000 });
  await expect(alice.locator("#leaderboard .score-row").first()).toContainText("Alice");
  await expect(bob.locator("#leaderboard .score-row").first()).toContainText("Alice");

  // The host plays again and both return to the lobby with ready reset.
  await alice.locator("#play-again-button").tap();
  await alice.waitForSelector('#app[data-phase="lobby"]', { timeout: 10_000 });
  await bob.waitForSelector('#app[data-phase="lobby"]', { timeout: 10_000 });
  await expect(alice.locator("#ready-button")).toHaveText("Mark ready");
  await waitForPlayers(alice, 2);

  await alice.close();
  await bob.close();
});

test("recovers from an offline drop with the same session identity", async ({ browser }) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  await joinRoom(bob, "Bob", code);
  await waitForPlayers(alice, 2);
  await waitForPlayers(bob, 2);
  const bobSessionId = await dataset(bob, "session-id");
  expect(bobSessionId).toBeTruthy();

  // Bob goes offline: both clients show the reconnecting state.
  await bob.context().setOffline(true);
  await expect(bob.locator("#reconnecting-overlay")).toBeVisible({ timeout: 5_000 });
  await alice.waitForFunction(
    () => document.querySelectorAll("#player-list .player-row.reconnecting").length === 1,
    undefined,
    { timeout: 10_000 },
  );

  // Bob comes back: the SDK auto-reconnects with the stored token.
  await bob.context().setOffline(false);
  await expect(bob.locator("#reconnecting-overlay")).toBeHidden({ timeout: 15_000 });
  await alice.waitForFunction(
    () => document.querySelectorAll("#player-list .player-row.reconnecting").length === 0,
    undefined,
    { timeout: 15_000 },
  );
  await waitForPlayers(bob, 2);

  // The same room-membership identity is restored.
  expect(await dataset(bob, "session-id")).toBe(bobSessionId);

  await alice.close();
  await bob.close();
});

test("invite link auto-joins visitors and shows a QR code", async ({ browser }) => {
  const alice = await openPhone(browser);
  const code = await createRoom(alice, "Alice");

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
    localStorage.setItem("tap-race:name", savedName);
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
