import { COIN_RUSH_CONSTANTS } from "@phone-party/protocol";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

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

function arena(page: Page): Locator {
  return page.getByTestId("coin-rush-arena");
}

async function waitForPhase(page: Page, phase: string, timeout = 20_000): Promise<void> {
  await expect(arena(page)).toHaveAttribute("data-phase", phase, { timeout });
}

async function arenaState(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="coin-rush-arena"]');
    if (!element) {
      throw new Error("arena missing");
    }
    return {
      phase: element.getAttribute("data-phase") ?? "",
      round: Number(element.getAttribute("data-round") ?? 0),
      x: Number(element.getAttribute("data-x") ?? -1),
      y: Number(element.getAttribute("data-y") ?? -1),
      alive: element.getAttribute("data-alive") === "true",
      score: Number(element.getAttribute("data-score") ?? 0),
      coins: JSON.parse(element.getAttribute("data-coins") ?? "[]") as Array<{
        value: number;
        col: number;
        row: number;
      }>,
      rows: JSON.parse(element.getAttribute("data-rows") ?? "[]") as Array<{
        row: number;
        terrain: "safe" | "road";
        direction: number;
        speed: number;
        vehicleLength: number;
        spacing: number;
        offset: number;
      }>,
    };
  });
}

async function swipe(page: Page, direction: "up" | "down" | "left" | "right"): Promise<void> {
  const box = await arena(page).boundingBox();
  if (!box) {
    throw new Error("arena has no bounding box");
  }
  const client = await page.context().newCDPSession(page);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const delta =
    direction === "up"
      ? { x: 0, y: -70 }
      : direction === "down"
        ? { x: 0, y: 70 }
        : direction === "left"
          ? { x: -70, y: 0 }
          : { x: 70, y: 0 };
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY }],
  });
  for (let step = 1; step <= 5; step++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: startX + (delta.x * step) / 5,
          y: startY + (delta.y * step) / 5,
        },
      ],
    });
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function waitCellClear(page: Page, col: number, row: number): Promise<void> {
  await page.waitForFunction(
    ({ col, row, margin, playerMargin }) => {
      const element = document.querySelector('[data-testid="coin-rush-arena"]');
      if (!element) {
        return false;
      }
      const rows = JSON.parse(element.getAttribute("data-rows") ?? "[]") as Array<{
        row: number;
        terrain: "safe" | "road";
        direction: number;
        speed: number;
        vehicleLength: number;
        spacing: number;
        offset: number;
      }>;
      const elapsed = Number(element.getAttribute("data-elapsed") ?? 0);
      const rowState = rows.find((candidate) => candidate.row === row);
      if (rowState?.terrain !== "road") {
        return true;
      }
      const clear = (horizon: number): boolean => {
        const travel = (rowState.speed * (elapsed + horizon)) / 1000;
        const raw = rowState.direction > 0 ? rowState.offset + travel : rowState.offset - travel;
        const wrapped = raw % rowState.spacing;
        const left = wrapped < 0 ? wrapped + rowState.spacing : wrapped;
        const vehicleLeft = left + margin;
        const vehicleRight = left + rowState.vehicleLength - margin;
        const playerLeft = col + playerMargin;
        const playerRight = col + 1 - playerMargin;
        const maxCopy = Math.ceil((9 + rowState.vehicleLength) / rowState.spacing) + 1;
        for (let copy = -1; copy <= maxCopy; copy++) {
          const copyLeft = vehicleLeft + copy * rowState.spacing;
          const copyRight = vehicleRight + copy * rowState.spacing;
          if (copyLeft < playerRight && copyRight > playerLeft) {
            return false;
          }
        }
        return true;
      };
      return clear(0) && clear(150);
    },
    {
      col,
      row,
      margin: COIN_RUSH_CONSTANTS.VEHICLE_COLLISION_MARGIN,
      playerMargin: COIN_RUSH_CONSTANTS.PLAYER_COLLISION_MARGIN,
    },
    { timeout: 15_000 },
  );
}

async function moveTo(page: Page, targetCol: number, targetRow: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const state = await arenaState(page);
    if (state.x === targetCol && state.y === targetRow) {
      return;
    }
    if (!state.alive) {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="coin-rush-arena"]')?.getAttribute("data-alive") ===
          "true",
        undefined,
        { timeout: 10_000 },
      );
      continue;
    }
    const path = await planPath(state, targetCol, targetRow);
    for (const step of path) {
      await waitCellClear(page, step.x, step.y);
      const current = await arenaState(page);
      if (current.x !== state.x || current.y !== state.y || !current.alive) {
        break;
      }
      const direction =
        step.x > current.x
          ? "right"
          : step.x < current.x
            ? "left"
            : step.y > current.y
              ? "up"
              : "down";
      await swipe(page, direction);
      await page.waitForFunction(
        ({ nextX, nextY }) => {
          const element = document.querySelector('[data-testid="coin-rush-arena"]');
          if (!element) {
            return false;
          }
          return (
            element.getAttribute("data-alive") !== "true" ||
            (Number(element.getAttribute("data-x")) === nextX &&
              Number(element.getAttribute("data-y")) === nextY)
          );
        },
        { nextX: step.x, nextY: step.y },
        { timeout: 10_000 },
      );
      const after = await arenaState(page);
      if (!after.alive || after.x !== step.x || after.y !== step.y) {
        break;
      }
    }
  }
  throw new Error(`Could not reach ${targetCol}:${targetRow}`);
}

async function planPath(
  state: Awaited<ReturnType<typeof arenaState>>,
  targetCol: number,
  targetRow: number,
): Promise<Array<{ x: number; y: number }>> {
  const blocked = new Set<string>();
  for (const row of state.rows) {
    if (row.terrain !== "road" || row.speed !== 0) {
      continue;
    }
    const left = row.offset;
    const vehicleLeft = left + COIN_RUSH_CONSTANTS.VEHICLE_COLLISION_MARGIN;
    const vehicleRight = left + row.vehicleLength - COIN_RUSH_CONSTANTS.VEHICLE_COLLISION_MARGIN;
    for (let col = 0; col < COIN_RUSH_CONSTANTS.COL_COUNT; col++) {
      const playerLeft = col + COIN_RUSH_CONSTANTS.PLAYER_COLLISION_MARGIN;
      const playerRight = col + 1 - COIN_RUSH_CONSTANTS.PLAYER_COLLISION_MARGIN;
      if (vehicleLeft < playerRight && vehicleRight > playerLeft) {
        blocked.add(`${col}:${row.row}`);
      }
    }
  }

  const queue: Array<{ x: number; y: number; path: Array<{ x: number; y: number }> }> = [
    { x: state.x, y: state.y, path: [] },
  ];
  const visited = new Set<string>([`${state.x}:${state.y}`]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (current.x === targetCol && current.y === targetRow) {
      return current.path;
    }
    const moves = [
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
    ];
    for (const next of moves) {
      const key = `${next.x}:${next.y}`;
      if (
        next.x < 0 ||
        next.x >= COIN_RUSH_CONSTANTS.COL_COUNT ||
        next.y < 0 ||
        next.y >= COIN_RUSH_CONSTANTS.ROW_COUNT ||
        visited.has(key) ||
        blocked.has(key)
      ) {
        continue;
      }
      visited.add(key);
      queue.push({ x: next.x, y: next.y, path: [...current.path, next] });
    }
  }
  throw new Error(`No path to ${targetCol}:${targetRow}`);
}

async function collectUntilRoundEnd(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await arenaState(page);
    if (state.phase !== "playing") {
      return;
    }
    const coins = [...state.coins].sort((a, b) => a.value - b.value);
    const before = state.score;
    for (const coin of coins) {
      await moveTo(page, coin.col, coin.row);
      const after = await arenaState(page);
      if (after.score > before) {
        break;
      }
    }
    if ((await arenaState(page)).phase !== "playing") {
      return;
    }
  }
  throw new Error("Round did not end after repeated coin collection");
}

test("two phones play a complete three-round Coin Rush match", async ({ browser }) => {
  test.setTimeout(240_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Coin Rush" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await arena(alice).waitFor({ timeout: 15_000 });
  await arena(bob).waitFor({ timeout: 15_000 });
  await waitForPhase(alice, "playing", 15_000);
  await waitForPhase(bob, "playing", 15_000);

  const aliceCoins = (await arenaState(alice)).coins;
  const bobCoins = (await arenaState(bob)).coins;
  expect(aliceCoins).toEqual(bobCoins);

  for (let round = 1; round <= 3; round++) {
    expect((await arenaState(alice)).round).toBe(round);
    expect((await arenaState(bob)).round).toBe(round);
    await moveTo(bob, 8, 0);
    await collectUntilRoundEnd(alice);
    await waitForPhase(alice, "round-result");
    await waitForPhase(bob, "round-result");
    const aliceWinners = JSON.parse(
      (await arena(alice).getAttribute("data-winners")) ?? "[]",
    ) as string[];
    const bobWinners = JSON.parse(
      (await arena(bob).getAttribute("data-winners")) ?? "[]",
    ) as string[];
    expect(aliceWinners).toHaveLength(1);
    expect(aliceWinners).toEqual(bobWinners);
    if (round < 3) {
      await waitForPhase(alice, "countdown");
      await waitForPhase(bob, "countdown");
      await waitForPhase(alice, "playing", 15_000);
      await waitForPhase(bob, "playing", 15_000);
    }
  }

  await expect(alice.getByTestId("coin-rush-leaderboard")).toBeVisible({ timeout: 20_000 });
  await expect(bob.getByTestId("coin-rush-leaderboard")).toBeVisible({ timeout: 20_000 });
  await expect(alice.getByTestId("coin-rush-leaderboard")).toContainText("Alice");
  await expect(alice.getByTestId("coin-rush-leaderboard")).toContainText("3 wins");

  await alice.getByRole("button", { name: "Play again" }).click();
  await waitForPhase(alice, "countdown");
  await waitForPhase(bob, "countdown");
  expect((await arenaState(alice)).round).toBe(1);
  expect((await arenaState(bob)).round).toBe(1);

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
