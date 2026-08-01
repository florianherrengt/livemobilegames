import { CAPITALS } from "@falling-platforms/capital-pin/server";
import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * Blank local style served instead of the external tile style. The results
 * test only needs the map canvas and markers, not real tiles, and this keeps
 * the suite deterministic offline.
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
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
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
  await page.goto("/capital-pin/");
  await page.getByRole("textbox", { name: "Your name" }).fill(name);
  await page.getByRole("button", { name: "Create room" }).tap();
  await expect(page.locator(".code-row .code")).not.toBeEmpty({ timeout: 15_000 });
  return (await page.locator(".code-row .code").textContent()) ?? "";
}

async function joinRoom(page: Page, name: string, code: string): Promise<void> {
  await page.goto("/capital-pin/");
  await page.getByRole("textbox", { name: "Your name" }).fill(name);
  await page.getByRole("textbox", { name: "Room code" }).fill(code);
  await page.getByRole("button", { name: "Join room" }).tap();
  await expect(page.locator(".code-row .code")).toHaveText(code, { timeout: 15_000 });
}

async function dropPin(page: Page): Promise<void> {
  const box = await page.locator(".map-container").boundingBox();
  if (!box) {
    throw new Error("round map has no bounding box");
  }
  await page
    .locator(".map-container")
    .tap({ position: { x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) } });
  await expect(page.getByRole("button", { name: "Lock answer" })).toBeEnabled();
}

test("two players lock their answers and the results map shows the capital pin", async ({
  browser,
}) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.locator(".player-row")).toHaveCount(2, { timeout: 15_000 });
  await expect(bob.locator(".player-row")).toHaveCount(2, { timeout: 15_000 });

  // Host starts the game; both phones enter round 1.
  await alice.getByRole("button", { name: "Start game" }).tap();
  await alice.waitForSelector('.app[data-screen="round"]', { timeout: 15_000 });
  await bob.waitForSelector('.app[data-screen="round"]', { timeout: 15_000 });
  const capitalName = ((await alice.locator(".round-header .capital").textContent()) ?? "").trim();
  expect(capitalName).not.toBe("");
  // Note: E2E_TEST_MODE is intentionally off for this suite, so the round
  // timer is 45s and the results screen stays up for 8s. The round still ends
  // immediately once both players lock, but the map assertions below get a
  // deterministic window instead of racing the 300ms e2e results phase.

  // Both players drop a pin and lock their answer.
  await dropPin(alice);
  await dropPin(bob);
  await alice.getByRole("button", { name: "Lock answer" }).tap();
  await bob.getByRole("button", { name: "Lock answer" }).tap();

  // All connected players submitted -> the round ends and both see results.
  await alice.waitForSelector('.app[data-screen="results"]', { timeout: 15_000 });
  await bob.waitForSelector('.app[data-screen="results"]', { timeout: 15_000 });

  const capital = CAPITALS.find((entry) => entry.city === capitalName);
  expect(capital).toBeDefined();

  for (const page of [alice, bob]) {
    // The results screen shows a real map, not just the standings panel.
    await expect(page.locator(".map-container .maplibregl-canvas")).toBeVisible({
      timeout: 15_000,
    });

    // The capital star sits exactly on the correct city coordinates.
    const star = page.locator(".pin-marker", { hasText: "★" });
    await expect(star).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(".pin-marker")).toHaveCount(3, { timeout: 15_000 });
    const latitude = Number(await star.getAttribute("data-lat"));
    const longitude = Number(await star.getAttribute("data-lng"));
    expect(latitude).toBeCloseTo(capital.latitude, 4);
    expect(longitude).toBeCloseTo(capital.longitude, 4);

    // Both revealed guesses are pinned (one initial each).
    await expect(page.locator(".pin-marker", { hasText: "A" })).toHaveCount(1);
    await expect(page.locator(".pin-marker", { hasText: "B" })).toHaveCount(1);

    // The standings panel names the revealed round.
    await expect(page.locator(".results-panel")).toContainText(capitalName);
  }

  await alice.close();
  await bob.close();
});

test("invite link auto-joins visitors and shows a QR code", async ({ browser }) => {
  const alice = await openPhone(browser);
  const code = await createRoom(alice, "Alice");

  const inviteUrlInput = alice.locator(".invite-url");
  await expect(inviteUrlInput).not.toHaveValue("");
  const inviteUrl = await inviteUrlInput.inputValue();
  expect(inviteUrl).toContain(`code=${code}`);
  await expect(alice.locator(".invite-qr canvas")).toBeVisible({ timeout: 10_000 });

  // A visitor with a saved name joins automatically from the invite link.
  const bobContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await bobContext.addInitScript((savedName) => {
    localStorage.setItem("capital-pin:name", savedName);
  }, "Bob");
  const bob = await bobContext.newPage();
  await bob.goto(inviteUrl);
  await expect(bob.locator(".code-row .code")).toHaveText(code, { timeout: 15_000 });
  await expect(alice.locator(".player-row")).toHaveCount(2, { timeout: 15_000 });
  await expect(bob.locator(".player-row")).toHaveCount(2, { timeout: 15_000 });

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
  await expect(stranger.locator(".hint")).toContainText(code);
  await expect(stranger.getByRole("textbox", { name: "Room code" })).toHaveValue(code);

  await alice.close();
  await bob.close();
  await stranger.close();
});
