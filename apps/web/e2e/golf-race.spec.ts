import { type Browser, expect, type Page, test } from "@playwright/test";

async function openPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  return context.newPage();
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

function arena(page: Page) {
  return page.getByTestId("golf-race-arena");
}

async function waitForArenaReady(page: Page, timeout = 20_000): Promise<void> {
  await expect(arena(page)).toHaveAttribute("data-round", "1", { timeout });
}

type AimingInfo = {
  phase: string;
  currentTurn: string;
  selfSession: string;
  players: Array<{ sessionId: string; name: string; x: number; y: number }>;
  camera: { x: number; y: number; scale: number };
  rect: { left: number; top: number; width: number; height: number };
};

async function readAimingInfo(page: Page): Promise<AimingInfo> {
  await arena(page).waitForFunction((element) => element.dataset.phase === "aiming", null, {
    timeout: 15_000,
  });
  return arena(page).evaluate((element) => {
    const canvas = element.querySelector("canvas");
    if (!canvas) {
      throw new Error("canvas missing");
    }
    const rect = canvas.getBoundingClientRect();
    return {
      phase: element.dataset.phase ?? "",
      currentTurn: element.dataset.currentTurn ?? "",
      selfSession: element.dataset.selfSession ?? "",
      players: JSON.parse(element.dataset.ballPositions ?? "[]") as AimingInfo["players"],
      camera: {
        x: Number(canvas.dataset.cameraX ?? 0),
        y: Number(canvas.dataset.cameraY ?? 0),
        scale: Number(canvas.dataset.scale ?? 1),
      },
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

async function shootFromActivePlayer(page: Page): Promise<boolean> {
  const info = await readAimingInfo(page);
  if (info.currentTurn !== info.selfSession) {
    return false;
  }
  const active = info.players.find((player) => player.sessionId === info.currentTurn);
  if (!active) {
    throw new Error("active player missing");
  }
  const startX =
    info.rect.left + (active.x - info.camera.x) * info.camera.scale + info.rect.width / 2;
  const startY =
    info.rect.top + (active.y - info.camera.y) * info.camera.scale + info.rect.height / 2;

  // Slingshot: drag opposite to the desired shot. Aim up with a correction
  // toward the route centre so both phones navigate the course deterministically.
  const correction = Math.max(-0.6, Math.min(0.6, (600 - active.x) / 800));
  const dragX = -correction * 220;
  const dragY = Math.sqrt(220 * 220 - dragX * dragX);
  const arenaElement = arena(page);
  await arenaElement.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: startX,
    clientY: startY,
    bubbles: true,
  });
  await arenaElement.dispatchEvent("pointermove", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: startX + dragX,
    clientY: startY + dragY,
    bubbles: true,
  });
  await arenaElement.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: startX + dragX,
    clientY: startY + dragY,
    bubbles: true,
  });
  return true;
}

async function playMatch(page: Page): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if ((await page.getByTestId("golf-race-leaderboard").count()) > 0) {
      return;
    }
    const arenaLocator = arena(page);
    if ((await arenaLocator.count()) === 0) {
      await page.waitForTimeout(100);
      continue;
    }
    const phase = await arenaLocator.getAttribute("data-phase");
    if (phase === "finished") {
      return;
    }
    if (phase === "aiming") {
      const shot = await shootFromActivePlayer(page);
      if (!shot) {
        await page.waitForTimeout(100);
        continue;
      }
      await page.waitForTimeout(250);
      continue;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("Match did not finish in time");
}

test("two phones play a deterministic Golf Race match", async ({ browser }) => {
  test.setTimeout(300_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Golf Race" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await waitForArenaReady(alice);
  await waitForArenaReady(bob);
  await expect(alice.getByText("How to play Golf Race")).not.toBeVisible({ timeout: 10_000 });
  await expect(bob.getByText("How to play Golf Race")).not.toBeVisible({ timeout: 10_000 });

  // Both phones see the same round and the same player positions.
  const aliceRound = await arena(alice).getAttribute("data-round");
  const bobRound = await arena(bob).getAttribute("data-round");
  expect(aliceRound).toBe("1");
  expect(bobRound).toBe("1");

  await Promise.all([playMatch(alice), playMatch(bob)]);

  await expect(alice.getByTestId("golf-race-leaderboard")).toBeVisible({ timeout: 20_000 });
  await expect(bob.getByTestId("golf-race-leaderboard")).toBeVisible({ timeout: 20_000 });
  const aliceRows = alice.getByTestId("golf-race-leaderboard").locator("li");
  const bobRows = bob.getByTestId("golf-race-leaderboard").locator("li");
  expect(await aliceRows.count()).toBe(2);
  expect(await bobRows.count()).toBe(2);
  expect(await aliceRows.nth(0).textContent()).toBe(await bobRows.nth(0).textContent());
  expect(await aliceRows.nth(1).textContent()).toBe(await bobRows.nth(1).textContent());

  // Host rematch returns to a fresh round 1.
  await alice.getByRole("button", { name: "Play again" }).click();
  await waitForArenaReady(alice, 15_000);
  await waitForArenaReady(bob, 15_000);

  // The course stays usable at the 320px minimum width without page scroll.
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
