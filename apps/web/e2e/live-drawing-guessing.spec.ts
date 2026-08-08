import { type Browser, expect, type Page, test } from "@playwright/test";

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

async function joinRunningDrawingRoom(page: Page, name: string, code: string): Promise<void> {
  await page.goto("/");
  await page.locator("#room-code").fill(code.toLowerCase());
  await page.locator("#join-player-name").fill(name);
  await page.getByRole("button", { name: "Join room" }).click();
  await page.getByTestId("ldg-canvas").waitFor({ timeout: 15_000 });
}

function canvas(page: Page) {
  return page.getByTestId("ldg-canvas");
}

async function waitForPhase(page: Page, phase: string, timeout = 15_000): Promise<void> {
  await expect(canvas(page)).toHaveAttribute("data-phase", phase, { timeout });
}

async function waitForTurn(page: Page, turn: number, timeout = 15_000): Promise<void> {
  await expect(canvas(page)).toHaveAttribute("data-turn", String(turn), { timeout });
}

async function drawerWord(page: Page): Promise<string> {
  await expect(page.getByTestId("ldg-drawer-word")).not.toHaveText("…", {
    timeout: 5_000,
  });
  const word = (await page.getByTestId("ldg-drawer-word").textContent())?.trim() ?? "";
  expect(word).not.toBe("");
  return word;
}

async function drawStroke(page: Page, seed: number): Promise<void> {
  const box = await canvas(page).boundingBox();
  if (!box) {
    throw new Error("canvas has no bounding box");
  }
  const startX = box.x + box.width * (0.2 + (seed % 3) * 0.08);
  const startY = box.y + box.height * (0.3 + (seed % 2) * 0.1);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let index = 1; index <= 5; index += 1) {
    await page.mouse.move(startX + index * box.width * 0.08, startY + index * box.height * 0.06);
  }
  await page.mouse.up();
}

async function submitGuess(page: Page, word: string): Promise<void> {
  await page.getByLabel("Your guess").fill(word);
  await page.getByTestId("ldg-guess-submit").tap();
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

test("two phones play a complete Live Drawing & Guessing match", async ({ browser }) => {
  test.setTimeout(120_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Live Drawing & Guessing" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await canvas(alice).waitFor({ timeout: 15_000 });
  await canvas(bob).waitFor({ timeout: 15_000 });
  await expect(alice.getByText("How to play Live Drawing & Guessing")).toBeVisible();
  await expect(bob.getByText("How to play Live Drawing & Guessing")).toBeVisible();

  // A third independent browser joins after play starts. The unlocked drawing
  // room admits Carol as a spectator without changing the frozen six-turn
  // participant order.
  const carol = await openPhone(browser);
  await joinRunningDrawingRoom(carol, "Carol", code);
  await expect(carol.getByText("Spectating").first()).toBeVisible();
  await expect(carol.getByLabel("Your guess")).toHaveCount(0);
  await expect(canvas(carol)).toHaveAttribute("data-interactive", "false");

  // Play all six turns: draw, let the guesser read the word from the drawer's
  // private screen, submit it, and confirm both phones advance together.
  for (let turn = 1; turn <= 6; turn += 1) {
    await waitForTurn(alice, turn);
    await waitForTurn(bob, turn);
    await waitForPhase(alice, "drawing");
    await waitForPhase(bob, "drawing");

    const drawerIsAlice = (await alice.getByTestId("ldg-drawer-word").count()) === 1;
    const drawer = drawerIsAlice ? alice : bob;
    const guesser = drawerIsAlice ? bob : alice;
    const word = await drawerWord(drawer);

    await drawStroke(drawer, turn);
    // Diagnostic: confirm the drawer's own canvas echoed the stroke and the
    // turn is still active before checking the guesser.
    await expect
      .poll(
        async () => [
          Number(await drawer.locator('[data-testid="ldg-canvas"]').getAttribute("data-strokes")),
          await drawer.locator('[data-testid="ldg-canvas"]').getAttribute("data-phase"),
          await drawer.locator('[data-testid="ldg-canvas"]').getAttribute("data-turn"),
        ],
        { timeout: 2_000 },
      )
      .not.toEqual([0, `drawing`, String(turn)]);
    // The stroke synchronizes to the guesser's live canvas.
    await expect
      .poll(
        async () =>
          Number(await guesser.locator('[data-testid="ldg-canvas"]').getAttribute("data-strokes")),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    await submitGuess(guesser, word);
    // The first correct guess ends the turn immediately; both phones show the
    // result and then move to the next turn (or the final board).
    await expect
      .poll(
        async () => [
          await alice.locator('[data-testid="ldg-canvas"]').getAttribute("data-phase"),
          await alice.locator('[data-testid="ldg-canvas"]').getAttribute("data-turn"),
        ],
        { timeout: 10_000 },
      )
      .not.toEqual([`drawing`, String(turn)]);
    await expect
      .poll(
        async () => [
          await bob.locator('[data-testid="ldg-canvas"]').getAttribute("data-phase"),
          await bob.locator('[data-testid="ldg-canvas"]').getAttribute("data-turn"),
        ],
        { timeout: 10_000 },
      )
      .not.toEqual([`drawing`, String(turn)]);
  }

  await expect(alice.getByTestId("ldg-leaderboard")).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByTestId("ldg-leaderboard")).toBeVisible({ timeout: 15_000 });
  await expect(carol.getByTestId("ldg-leaderboard")).toBeVisible({ timeout: 15_000 });
  await expect(alice.getByText("Joint winners")).toBeVisible();
  await expect(alice.getByTestId("ldg-leaderboard")).toContainText("6 points");
  await expect(bob.getByTestId("ldg-leaderboard")).toContainText("6 points");

  // Host rematch returns to turn 1 with a fresh match.
  await alice.getByTestId("ldg-play-again").tap();
  await waitForTurn(alice, 1);
  await waitForTurn(bob, 1);
  await waitForTurn(carol, 1);
  await expect(carol.getByText(/Turn 1\/9/)).toBeVisible();
  await expect(carol.getByText("Spectating")).toHaveCount(0);

  // The room is now old enough for the SDK's real reconnection path. Drop
  // Bob's live game socket and verify that the same phone returns to the
  // rematch instead of remaining on stale controls.
  await waitForPhase(bob, "drawing");
  await dropSocketAndObserveReconnect(bob);
  await expect(canvas(bob)).toBeVisible();

  // The game stays usable at the 320px minimum width without page scroll.
  for (const page of [alice, bob, carol]) {
    await page.setViewportSize({ width: 320, height: 568 });
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noHorizontalScroll).toBe(true);
  }

  await alice.close();
  await bob.close();
  await carol.close();
});
