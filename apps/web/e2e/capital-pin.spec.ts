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

test("two players play a Capital Pin round from lobby to results", async ({ browser }) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  // Host selects Capital Pin and starts once: the transition and the first
  // round begin automatically when every roster player has arrived.
  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Capital Pin" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await alice.locator(".cp-map-container").waitFor({ timeout: 15_000 });
  await bob.locator(".cp-map-container").waitFor({ timeout: 15_000 });
  await expect(alice.getByText(/Round 1 \/ 10/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Round 1 \/ 10/)).toBeVisible({ timeout: 15_000 });
  const capitalName = ((await alice.locator('[aria-live="polite"]').textContent()) ?? "").trim();
  expect(capitalName).not.toBe("");

  await dropPin(alice);
  await dropPin(bob);
  await alice.getByRole("button", { name: "Lock answer" }).tap();
  await bob.getByRole("button", { name: "Lock answer" }).tap();

  // All connected players submitted -> the round ends and both see results.
  for (const page of [alice, bob]) {
    await expect(page.getByText(`Round 1: ${capitalName}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".cp-map-container .maplibregl-canvas")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".cp-pin-marker")).toHaveCount(3, { timeout: 15_000 });
  }

  // The round and results screens stay usable at the 320px minimum width.
  for (const page of [alice, bob]) {
    await page.setViewportSize({ width: 320, height: 568 });
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noHorizontalScroll).toBe(true);
  }

  await alice.close();
  await bob.close();
});
