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
  return page.getByTestId("pong-arena");
}

async function waitForPhase(page: Page, phase: string, timeout = 20_000): Promise<void> {
  await expect(arena(page)).toHaveAttribute("data-phase", phase, { timeout });
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

test("two phones play a full Four-Sided Pong match to 10 and rematch", async ({ browser }) => {
  test.setTimeout(180_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Four-Sided Pong" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await waitForPhase(alice, "countdown");
  await waitForPhase(bob, "countdown");

  await waitForPhase(alice, "running", 15_000);
  await waitForPhase(bob, "running", 15_000);
  await expect(alice.getByText("How to play Four-Sided Pong")).not.toBeVisible();

  const aliceEdge = await arena(alice).getAttribute("data-local-edge");
  const bobEdge = await arena(bob).getAttribute("data-local-edge");
  expect([aliceEdge, bobEdge].sort()).toEqual(["bottom", "top"]);
  expect(aliceEdge).toBe("bottom");
  expect(await arena(alice).getAttribute("data-player-count")).toBe("2");
  expect(await arena(bob).getAttribute("data-player-count")).toBe("2");
  await alice.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="pong-arena"]');
      if (!element) {
        return false;
      }
      const balls = JSON.parse(element.getAttribute("data-balls") ?? "[]") as unknown[];
      return balls.length >= 1;
    },
    undefined,
    { timeout: 10_000 },
  );

  // The deterministic E2E launch reaches Alice's centred paddle without any
  // input; a real paddle hit must transfer shared ball ownership.
  await alice.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="pong-arena"]');
      if (!element) {
        return false;
      }
      const balls = JSON.parse(element.getAttribute("data-balls") ?? "[]") as Array<{
        owner: string;
      }>;
      return balls.some((ball) => ball.owner !== "");
    },
    undefined,
    { timeout: 30_000 },
  );

  // Both phones reach the same authoritative final scoreboard.
  await alice.getByTestId("pong-leaderboard").waitFor({ timeout: 120_000 });
  await expect(bob.getByTestId("pong-leaderboard")).toBeVisible({ timeout: 15_000 });
  const aliceBoard = (await alice.getByTestId("pong-leaderboard").innerText()).trim();
  const bobBoard = (await bob.getByTestId("pong-leaderboard").innerText()).trim();
  expect(bobBoard).toBe(aliceBoard);
  // The first authoritative goal to reach the target ends the match. Later
  // same-step exits cannot create co-winners or push the winner above ten.
  expect(aliceBoard).toMatch(/\b10 points\b/);
  expect(aliceBoard).not.toMatch(/\b1[12] points\b/);
  const aliceHeadline = await alice.locator('h2[aria-live="polite"]').innerText();
  const bobHeadline = await bob.locator('h2[aria-live="polite"]').innerText();
  expect(bobHeadline).toBe(aliceHeadline);

  // Host rematch resets the match to a single-ball countdown.
  await alice.getByRole("button", { name: "Play again" }).click();
  await waitForPhase(alice, "countdown", 15_000);
  await waitForPhase(bob, "countdown", 15_000);
  expect(await arena(alice).getAttribute("data-ball-count")).toBe("1");
  expect(await arena(alice).getAttribute("data-desired-ball-count")).toBe("1");
  expect(
    (
      JSON.parse((await arena(alice).getAttribute("data-scores")) ?? "[]") as Array<{
        score: number;
      }>
    ).every((entry) => entry.score === 0),
  ).toBe(true);

  // Exercise a real transient socket loss after the room has exceeded the
  // SDK's minimum uptime. Bob must return to the same two-player rematch with
  // live controls rather than forcing a terminal one-player result.
  await waitForPhase(bob, "running", 15_000);
  await dropSocketAndObserveReconnect(bob);
  await expect(arena(bob)).toHaveAttribute("data-player-count", "2");
  await expect(arena(bob)).toHaveAttribute("aria-disabled", "false");

  // The arena stays usable at the 320px minimum width without page scroll.
  for (const page of [alice, bob]) {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByTestId("pong-arena").waitFor({ timeout: 10_000 });
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noHorizontalScroll).toBe(true);
  }

  await alice.close();
  await bob.close();
});

test("touch anywhere on the screen steers the paddle by the centre line", async ({ browser }) => {
  test.setTimeout(60_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Four-Sided Pong" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();
  await waitForPhase(alice, "countdown");

  const box = await arena(alice).boundingBox();
  if (!box) {
    throw new Error("arena missing");
  }
  const leftX = box.x + box.width * 0.2;
  const rightX = box.x + box.width * 0.8;

  await alice.evaluate((x) => {
    const element = document.querySelector('[data-testid="pong-arena"]');
    element?.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 3,
        pointerType: "touch",
        bubbles: true,
        clientX: x,
        clientY: 200,
      }),
    );
  }, leftX);
  await expect(arena(alice)).toHaveAttribute("data-direction", "left", { timeout: 2_000 });
  await alice.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="pong-arena"]');
      const paddleMin = Number(element?.getAttribute("data-paddle-min") ?? 0);
      const paddleCenter = Number(element?.getAttribute("data-paddle-center") ?? 0);
      return paddleCenter < paddleMin + 120;
    },
    undefined,
    { timeout: 2_000 },
  );

  await alice.evaluate((x) => {
    const element = document.querySelector('[data-testid="pong-arena"]');
    element?.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 3,
        pointerType: "touch",
        bubbles: true,
        clientX: x,
        clientY: 200,
      }),
    );
  }, rightX);
  await expect(arena(alice)).toHaveAttribute("data-direction", "right", { timeout: 2_000 });
  await alice.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="pong-arena"]');
      const paddleMax = Number(element?.getAttribute("data-paddle-max") ?? 0);
      const paddleCenter = Number(element?.getAttribute("data-paddle-center") ?? 0);
      return paddleCenter > paddleMax - 120;
    },
    undefined,
    { timeout: 2_000 },
  );

  await alice.evaluate(() => {
    const element = document.querySelector('[data-testid="pong-arena"]');
    element?.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 3,
        pointerType: "touch",
        bubbles: true,
        clientX: 0,
        clientY: 200,
      }),
    );
  });

  // Bob's top edge is rotated to the local bottom. Screen-left therefore maps
  // to the high end of the world-edge coordinate, and screen-right to low.
  const bobBox = await arena(bob).boundingBox();
  if (!bobBox) {
    throw new Error("Bob arena missing");
  }
  const bobLeftX = bobBox.x + bobBox.width * 0.2;
  const bobRightX = bobBox.x + bobBox.width * 0.8;
  await bob.evaluate((x) => {
    const element = document.querySelector('[data-testid="pong-arena"]');
    element?.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 4,
        pointerType: "touch",
        bubbles: true,
        clientX: x,
        clientY: 200,
      }),
    );
  }, bobLeftX);
  await expect(arena(bob)).toHaveAttribute("data-direction", "left", { timeout: 2_000 });
  await bob.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="pong-arena"]');
      const paddleMax = Number(element?.getAttribute("data-paddle-max") ?? 0);
      const paddleCenter = Number(element?.getAttribute("data-paddle-center") ?? 0);
      return paddleCenter > paddleMax - 120;
    },
    undefined,
    { timeout: 2_000 },
  );
  await bob.evaluate((x) => {
    const element = document.querySelector('[data-testid="pong-arena"]');
    element?.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 4,
        pointerType: "touch",
        bubbles: true,
        clientX: x,
        clientY: 200,
      }),
    );
  }, bobRightX);
  await expect(arena(bob)).toHaveAttribute("data-direction", "right", { timeout: 2_000 });
  await bob.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="pong-arena"]');
      const paddleMin = Number(element?.getAttribute("data-paddle-min") ?? 0);
      const paddleCenter = Number(element?.getAttribute("data-paddle-center") ?? 0);
      return paddleCenter < paddleMin + 120;
    },
    undefined,
    { timeout: 2_000 },
  );
  await bob.evaluate(() => {
    const element = document.querySelector('[data-testid="pong-arena"]');
    element?.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 4,
        pointerType: "touch",
        bubbles: true,
        clientX: 0,
        clientY: 200,
      }),
    );
  });
  await alice.close();
  await bob.close();
});
