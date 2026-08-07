import { type Browser, expect, type Page, test } from "@playwright/test";

async function openPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(() => {
    sessionStorage.setItem("memory-path-e2e-driver", "1");
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
  return page.getByTestId("memory-path-arena");
}

async function waitForPhase(page: Page, phase: string, timeout = 20_000): Promise<void> {
  await expect(arena(page)).toHaveAttribute("data-phase", phase, { timeout });
}

async function waitForRoundRace(page: Page, round: number): Promise<void> {
  await expect(arena(page)).toHaveAttribute("data-round", String(round), { timeout: 20_000 });
  const phase = await arena(page).getAttribute("data-phase");
  if (phase !== "racing") {
    await waitForPhase(page, "racing", 20_000);
  }
}

async function getRoutePoints(page: Page): Promise<Array<[number, number]>> {
  const raw = await arena(page).getAttribute("data-route-points");
  return raw ? (JSON.parse(raw) as Array<[number, number]>) : [];
}

async function currentPosition(page: Page): Promise<{ x: number; y: number }> {
  const x = Number.parseFloat((await arena(page).getAttribute("data-local-x")) ?? "0");
  const y = Number.parseFloat((await arena(page).getAttribute("data-local-y")) ?? "0");
  return { x, y };
}

async function driveToFinish(
  page: Page,
  roundNumber: number,
  startIndex = 1,
  targetIndex?: number,
): Promise<void> {
  const points = await getRoutePoints(page);
  const speed = Number((await arena(page).getAttribute("data-speed")) ?? "0");
  const pathWidth = Number((await arena(page).getAttribute("data-path-width")) ?? "0");
  if (speed <= 0) {
    throw new Error("Authoritative movement speed is unavailable");
  }
  const cornerMargin = Math.max(8, pathWidth / 4);
  const endIndex = targetIndex ?? points.length;
  for (let index = startIndex; index < endIndex; index++) {
    const target = points[index];
    if (!target) {
      continue;
    }
    while (true) {
      const position = await currentPosition(page);
      const dx = target[0] - position.x;
      const dy = target[1] - position.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 30) {
        break;
      }
      const isLast = index === endIndex - 1;
      const travel = isLast ? distance : Math.max(0, distance - cornerMargin);
      const duration = Math.max(60, (travel / speed) * 1000);
      const useBothAxes = Math.abs(dx) > 25 && Math.abs(dy) > 25;
      const directionX = useBothAxes || Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
      const directionY = useBothAxes || Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0;
      await sendMove(page, directionX, directionY, roundNumber);
      await page.waitForTimeout(duration);
      const falling = await arena(page).getAttribute("data-falling");
      if (falling === "true") {
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="memory-path-arena"]')
              ?.getAttribute("data-falling") === "false",
          undefined,
          { timeout: 3_000 },
        );
        continue;
      }
      break;
    }
  }
  await sendMove(page, 0, 0, roundNumber);
}

async function sendMove(page: Page, x: number, y: number, roundNumber: number): Promise<void> {
  await page.evaluate(
    ({ directionX, directionY, round }) => {
      const driverWindow = window as unknown as {
        __memoryPathRoom?: {
          send: (type: string, payload?: unknown) => void;
        };
        __memoryPathSequence?: number;
      };
      if (!driverWindow.__memoryPathRoom) {
        throw new Error("Memory Path E2E driver room is not connected");
      }
      driverWindow.__memoryPathSequence = (driverWindow.__memoryPathSequence ?? 0) + 1;
      driverWindow.__memoryPathRoom.send("game:move", {
        type: "move",
        sequence: driverWindow.__memoryPathSequence,
        roundNumber: round,
        x: directionX,
        y: directionY,
      });
    },
    { directionX: x, directionY: y, round: roundNumber },
  );
}

async function verifyJoystickMovesPlayer(page: Page): Promise<void> {
  const points = await getRoutePoints(page);
  const target = points[1];
  if (!target) {
    throw new Error("Route has no second point");
  }
  const before = await currentPosition(page);
  const dx = target[0] - before.x;
  const dy = target[1] - before.y;
  const directionX = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
  const directionY = Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0;
  const joystick = page.getByTestId("memory-path-joystick");
  const box = await joystick.boundingBox();
  if (!box) {
    throw new Error("Movement joystick is not visible");
  }
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const maxTravel = box.width / 2 - 28;
  await page.mouse.move(centreX, centreY);
  await page.mouse.down();
  await page.mouse.move(centreX + directionX * maxTravel, centreY + directionY * maxTravel);
  await page.waitForTimeout(350);
  await page.mouse.up();
  const after = await currentPosition(page);
  if (Math.hypot(after.x - before.x, after.y - before.y) < 20) {
    throw new Error("The on-screen joystick did not move the local player");
  }
}

async function waitForRoundResult(page: Page, round: number, timeout = 20_000): Promise<string[]> {
  const handle = await page.waitForFunction(
    (expectedRound) => {
      const element = document.querySelector('[data-testid="memory-path-arena"]');
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
  const value = (await handle.jsonValue()) as { winners: string[] };
  return value.winners;
}

test("two phones play a deterministic full Memory Path match", async ({ browser }) => {
  test.setTimeout(120_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Memory Path" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await waitForPhase(alice, "preparing");
  await waitForPhase(bob, "preparing");
  await waitForPhase(alice, "preview");
  await waitForPhase(bob, "preview");
  expect(await arena(alice).getAttribute("data-path-visible")).toBe("true");
  expect(await arena(bob).getAttribute("data-path-visible")).toBe("true");

  await waitForPhase(alice, "racing");
  await waitForPhase(bob, "racing");
  expect(await arena(alice).getAttribute("data-path-visible")).toBe("false");
  expect(await arena(alice).getAttribute("data-opponents-visible")).toBe("false");

  // Round 1: pause halfway and wait for the scheduled flash, then finish.
  await driveToFinish(alice, 1, 1, 4);
  await pageWaitForFlash(alice);
  await driveToFinish(alice, 1, 4);
  const roundOneWinners = await waitForRoundResult(alice, 1);
  expect(roundOneWinners).toHaveLength(1);
  await waitForRoundResult(bob, 1);

  // Rounds 2-3: Alice finishes both; Bob idles.
  for (const round of [2, 3]) {
    await waitForRoundRace(alice, round);
    await driveToFinish(alice, round);
    const winners = await waitForRoundResult(alice, round);
    expect(winners).toHaveLength(1);
    await waitForRoundResult(bob, round);
  }

  await expect(alice.getByTestId("memory-path-leaderboard")).toBeVisible({ timeout: 20_000 });
  await expect(bob.getByTestId("memory-path-leaderboard")).toBeVisible({ timeout: 20_000 });
  await expect(alice.getByTestId("memory-path-leaderboard")).toContainText("Alice");
  await expect(alice.getByTestId("memory-path-leaderboard")).toContainText("3 wins");
  await expect(alice.getByTestId("memory-path-leaderboard")).toContainText("Bob");
  await expect(alice.getByTestId("memory-path-leaderboard")).toContainText("0 wins");

  await alice.getByRole("button", { name: "Play again" }).click();
  await waitForPhase(alice, "preparing");
  await waitForPhase(bob, "preparing");

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

test("the on-screen joystick moves the local player in a real game", async ({ browser }) => {
  test.setTimeout(60_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);
  const code = await createRoom(alice, "Alice");
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Memory Path" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();
  await waitForPhase(alice, "preparing");
  await waitForPhase(alice, "preview");
  await waitForPhase(alice, "racing");
  await verifyJoystickMovesPlayer(alice);

  await alice.close();
  await bob.close();
});

async function pageWaitForFlash(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="memory-path-arena"]');
      if (!element) {
        return false;
      }
      return (
        element.getAttribute("data-phase") === "racing" &&
        element.getAttribute("data-path-visible") === "true"
      );
    },
    undefined,
    { timeout: 8_000 },
  );
}
