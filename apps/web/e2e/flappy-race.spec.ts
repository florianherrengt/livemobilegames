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

function arena(page: Page) {
  return page.getByTestId("flappy-race-arena");
}

async function waitForPhase(page: Page, phase: string, timeout = 20_000): Promise<void> {
  await expect(arena(page)).toHaveAttribute("data-phase", phase, { timeout });
}

async function waitForRoundNumber(page: Page, round: number, timeout = 15_000): Promise<void> {
  await expect(arena(page)).toHaveAttribute("data-round", String(round), { timeout });
}

async function captureRoundResult(
  page: Page,
  round: number,
  timeout = 20_000,
): Promise<{ winners: string[] }> {
  const handle = await page.waitForFunction(
    (expectedRound) => {
      const element = document.querySelector('[data-testid="flappy-race-arena"]');
      if (!element) {
        return undefined;
      }
      if (element.getAttribute("data-phase") !== "round-result") {
        return undefined;
      }
      if (element.getAttribute("data-round") !== String(expectedRound)) {
        return undefined;
      }
      const raw = element.getAttribute("data-winners");
      return { winners: raw ? (JSON.parse(raw) as string[]) : [] };
    },
    round,
    { timeout },
  );
  return (await handle.jsonValue()) as { winners: string[] };
}

async function tapFlapRepeatedly(page: Page, count: number, intervalMs: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    const button = page.getByTestId("flappy-flap-button");
    if (await button.isDisabled()) {
      return;
    }
    await button.click({ force: true });
    await page.waitForTimeout(intervalMs);
  }
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

test("two phones play a deterministic five-round Flappy Race match", async ({ browser }) => {
  test.setTimeout(90_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Flappy Race" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await waitForPhase(alice, "countdown");
  await waitForPhase(bob, "countdown");
  await waitForPhase(alice, "running", 15_000);
  await waitForPhase(bob, "running", 15_000);
  await expect(alice.getByText("How to play Flappy Race")).not.toBeVisible();
  await expect(bob.getByText("How to play Flappy Race")).not.toBeVisible();

  const aliceOpenings = JSON.parse(
    (await arena(alice).getAttribute("data-openings")) ?? "[]",
  ) as number[];
  const bobOpenings = JSON.parse(
    (await arena(bob).getAttribute("data-openings")) ?? "[]",
  ) as number[];
  expect(aliceOpenings.length).toBeGreaterThan(0);
  expect(aliceOpenings).toEqual(bobOpenings);

  // Round 1: no taps -> both crash into the second obstacle and draw.
  const roundOnePromise = captureRoundResult(alice, 1);
  const carol = await openPhone(browser);
  await carol.goto("/");
  await carol.locator("#room-code").fill(code);
  await carol.locator("#join-player-name").fill("Carol");
  await carol.getByRole("button", { name: "Join room" }).click();
  await expect(carol.getByRole("alert")).toContainText(/cannot accept new players/i);
  await carol.close();
  const roundOne = await roundOnePromise;
  expect(roundOne.winners).toHaveLength(2);

  // Round 2: Alice flaps up and crashes early; Bob passes it and wins. The
  // capture starts before the flap loop because the E2E round-result phase is
  // short and can start and end while the clicks are still running.
  await waitForRoundNumber(alice, 2);
  const roundTwoPromise = captureRoundResult(alice, 2);
  await tapFlapRepeatedly(alice, 16, 90);
  const roundTwo = await roundTwoPromise;
  expect(roundTwo.winners).toHaveLength(1);

  // Rounds 3-4 draw; round 5 goes straight to the final scoreboard.
  const roundThreePromise = captureRoundResult(alice, 3);
  await waitForRoundNumber(alice, 3);
  expect((await roundThreePromise).winners).toHaveLength(2);
  const roundFourPromise = captureRoundResult(alice, 4);
  await waitForRoundNumber(alice, 4);
  expect((await roundFourPromise).winners).toHaveLength(2);

  await expect(alice.getByTestId("flappy-race-leaderboard")).toBeVisible({ timeout: 20_000 });
  await expect(bob.getByTestId("flappy-race-leaderboard")).toBeVisible({ timeout: 20_000 });
  await expect(alice.getByTestId("flappy-race-leaderboard")).toContainText("Bob");
  await expect(alice.getByTestId("flappy-race-leaderboard")).toContainText("5 wins");
  await expect(alice.getByTestId("flappy-race-leaderboard")).toContainText("Alice");
  await expect(alice.getByTestId("flappy-race-leaderboard")).toContainText("4 wins");
  await expect(alice.getByTestId("flappy-race-leaderboard").locator("li")).toHaveCount(2);
  await expect(bob.getByText("Waiting for the host to play again…")).toBeVisible();

  // Host rematch returns to the course with a fresh match.
  await alice.getByRole("button", { name: "Play again" }).click();
  await waitForRoundNumber(alice, 1);
  await waitForRoundNumber(bob, 1);

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

test("a dropped Flappy Race player reconnects as a spectator", async ({ browser }) => {
  test.setTimeout(45_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);
  const carol = await openPhone(browser);
  const code = await createRoom(alice, "Alice");
  await joinRoom(bob, "Bob", code);
  await joinRoom(carol, "Carol", code);
  await expect(alice.getByText(/Players \(3\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Flappy Race" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();
  await waitForPhase(alice, "running", 15_000);
  await waitForPhase(bob, "running", 15_000);
  const bobSessionId = await arena(bob).getAttribute("data-self-session");
  expect(bobSessionId).not.toBeNull();

  await dropSocketAndObserveReconnect(bob);

  await waitForRoundNumber(bob, 2, 15_000);
  await expect(arena(bob)).toHaveAttribute("data-self-session", bobSessionId ?? "");
  await expect(arena(bob)).toHaveAttribute("data-spectating", "true");
  await expect(bob.getByTestId("flappy-flap-button")).toBeDisabled();
  await expect(arena(alice)).toHaveAttribute("data-spectating", "false");

  await alice.close();
  await bob.close();
  await carol.close();
});
