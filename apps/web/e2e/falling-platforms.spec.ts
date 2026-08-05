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

async function swipeRight(page: Page): Promise<void> {
  const arena = page.getByTestId("falling-platforms-arena");
  // The swipe is dispatched on the arena itself with the same pointer
  // sequence the browser produces for a touch drag; coordinates stay inside
  // the viewport so the gesture is independent of the camera transform.
  await arena.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: 100,
    clientY: 100,
  });
  await arena.dispatchEvent("pointermove", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: 160,
    clientY: 100,
  });
  await arena.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: 160,
    clientY: 100,
  });
}

test("two phones play a deterministic Falling Platforms round and a second round", async ({
  browser,
}) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  // Host selects Falling Platforms and starts once: the transition and the
  // first round begin automatically when every roster player has arrived.
  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Falling Platforms" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await alice.getByTestId("falling-platforms-arena").waitFor({ timeout: 15_000 });
  await bob.getByTestId("falling-platforms-arena").waitFor({ timeout: 15_000 });
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-phase",
    "playing",
    { timeout: 15_000 },
  );
  await expect(bob.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-phase",
    "playing",
    { timeout: 15_000 },
  );
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-arena-side",
    "7",
  );
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-alive-count",
    "2",
  );
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-local-platform",
    "3:3",
  );
  await expect(bob.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-local-platform",
    "3:4",
  );

  // Alice swipes from 3:3 to 4:3; both phones see the authoritative movement.
  await swipeRight(alice);
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-local-jumping",
    "true",
    { timeout: 5_000 },
  );
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-local-platform",
    "4:3",
    { timeout: 10_000 },
  );
  await expect(bob.getByTestId("player-Alice")).toHaveAttribute("data-platform", "4:3", {
    timeout: 10_000,
  });

  // Bob's spawn is the deterministic first warning target: it warns, then
  // collapses and eliminates the standing player on both phones.
  await expect(alice.getByTestId("platform-3:4")).toHaveAttribute("data-state", "warning", {
    timeout: 10_000,
  });
  await expect(bob.getByTestId("platform-3:4")).toHaveAttribute("data-state", "warning", {
    timeout: 10_000,
  });
  await expect(bob.getByTestId("player-Bob")).toHaveAttribute("data-alive", "false", {
    timeout: 10_000,
  });
  await expect(bob.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-spectating",
    "true",
  );
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-alive-count",
    "1",
  );

  // Both phones observe the authoritative result.
  await expect(alice.getByText("Alice wins!")).toBeVisible({ timeout: 10_000 });
  await expect(bob.getByText("Alice wins!")).toBeVisible({ timeout: 10_000 });

  // Both return to the game-room lobby.
  await expect(alice.getByRole("button", { name: "Play again" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(bob.getByText("Waiting for the host to play again.")).toBeVisible({
    timeout: 15_000,
  });

  // A second round starts from the game-room Play again control.
  await alice.getByRole("button", { name: "Play again" }).click();
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-phase",
    "playing",
    { timeout: 15_000 },
  );
  await expect(bob.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-phase",
    "playing",
    { timeout: 15_000 },
  );
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute("data-round", "1");
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-alive-count",
    "2",
  );

  // The arena stays usable at the 320px minimum width without horizontal
  // page scroll.
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
