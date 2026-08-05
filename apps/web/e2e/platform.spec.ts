import { type BrowserContext, expect, type Page, test } from "@playwright/test";

test("home page shows no game catalogue before a room is created", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Phone Party" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Game catalogue" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Capital Pin" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Falling Platforms" })).toHaveCount(0);
});

test("room creation works before a game is chosen", async ({ page }) => {
  await page.goto("/");
  await page.locator("#create-player-name").fill("Alice");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(
    page.getByText("The host chooses a game, then everyone moves into it together."),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Choose a game" })).toBeVisible();
});

test("invalid join input shows client-side validation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByText("Enter a room code")).toBeVisible();
});

test("a valid but unknown room code shows a safe server error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Room code").fill("ABC234");
  await page.getByLabel("Your name").last().fill("Alice");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByText("Room not found")).toBeVisible();
});

test("the layout works at a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Phone Party" })).toBeVisible();
  const noHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noHorizontalScroll).toBe(true);
});

test("one player creates a room and three players join it", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  const hostContext = await browser.newContext();
  contexts.push(hostContext);
  const host = await hostContext.newPage();
  pages.push(host);
  await host.goto("/");
  await host.locator("#create-player-name").fill("Alice");
  await host.getByRole("button", { name: "Create room" }).click();
  await expect(
    host.getByText("The host chooses a game, then everyone moves into it together."),
  ).toBeVisible();
  const roomCode = (await host.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(roomCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);

  for (const playerName of ["Bob", "Carol", "Dave"]) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    await page.goto("/");
    await page.locator("#room-code").fill(roomCode.toLowerCase());
    await page.locator("#join-player-name").fill(playerName);
    await page.getByRole("button", { name: "Join room" }).click();
    await expect(page.getByTestId("room-code")).toHaveText(roomCode);
    await expect(
      page.getByText("The host chooses a game, then everyone moves into it together."),
    ).toBeVisible();
  }

  for (const page of pages) {
    await expect(page.getByText("Room ready")).toBeVisible();
    await expect(page.getByText(/Players \(4\)/)).toBeVisible();
    for (const playerName of ["Alice", "Bob", "Carol", "Dave"]) {
      await expect(page.getByText(new RegExp(playerName))).toBeVisible();
    }
  }

  await Promise.all(pages.map((page) => page.close()));
  await Promise.all(contexts.map((context) => context.close()));
});

test("a player can join through an invite link", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const host = await hostContext.newPage();
  await host.goto("/");
  await host.locator("#create-player-name").fill("Alice");
  await host.getByRole("button", { name: "Create room" }).click();
  await expect(host.getByText("Room ready")).toBeVisible();
  const roomCode = (await host.getByTestId("room-code").textContent())?.trim() ?? "";

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(`/room/${roomCode}`);
  await expect(guest.getByText(`Join room ${roomCode}`)).toBeVisible();
  await guest.locator("#join-link-name").fill("Bob");
  await guest.getByRole("button", { name: "Join room" }).click();
  await expect(guest.getByText("Room ready")).toBeVisible();
  await expect(guest.getByText(/Players \(2\)/)).toBeVisible();

  await host.close();
  await guest.close();
  await hostContext.close();
  await guestContext.close();
});

test("the host can copy the room code", async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("#create-player-name").fill("Alice");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByText("Room ready")).toBeVisible();
  const roomCode = (await page.getByTestId("room-code").textContent())?.trim() ?? "";

  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(roomCode);

  await page.close();
  await context.close();
});
