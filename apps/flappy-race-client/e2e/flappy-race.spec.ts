import { type Browser, expect, type Page, test } from "@playwright/test";

const TAP_X = 195;
const TAP_Y = 480;

async function openPhone(
  browser: Browser,
  viewport?: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 390, height: 844 },
    screen: viewport ?? { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  return context.newPage();
}

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto("/flappy-race/");
  await page.locator("#name-input").fill(name);
  await page.locator("#create-button").tap();
  await expect(page.locator("#lobby-code")).not.toBeEmpty({ timeout: 15_000 });
  return (await page.locator("#lobby-code").textContent()) ?? "";
}

async function joinRoom(page: Page, name: string, code: string): Promise<void> {
  await page.goto("/flappy-race/");
  await page.locator("#name-input").fill(name);
  await page.locator("#code-input").fill(code);
  await page.locator("#join-button").tap();
  await expect(page.locator("#lobby-code")).toHaveText(code, { timeout: 15_000 });
}

async function waitForPlayers(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (expected) => document.querySelectorAll("#player-list .player-row").length === expected,
    count,
    { timeout: 15_000 },
  );
}

async function dataset(page: Page, key: string): Promise<string | undefined> {
  return page.evaluate((name) => {
    return document.querySelector("#app")?.getAttribute(`data-${name}`) ?? undefined;
  }, key);
}

async function waitForPhase(page: Page, phase: string, timeout = 20_000): Promise<void> {
  await page.waitForSelector(`#app[data-phase="${phase}"]`, { timeout });
}

async function waitForRoundResult(page: Page, round: number, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const app = document.querySelector("#app");
      return (
        app?.getAttribute("data-phase") === "round-result" &&
        app?.getAttribute("data-round") === String(expected)
      );
    },
    round,
    { timeout },
  );
}

async function playersSummary(page: Page): Promise<
  Array<{
    name: string;
    roundWins: number;
    clearedObstacleCount: number;
    roundActive: boolean;
    birdY: number;
  }>
> {
  const raw = await dataset(page, "players");
  return raw
    ? (JSON.parse(raw) as Array<{
        name: string;
        roundWins: number;
        clearedObstacleCount: number;
        roundActive: boolean;
        birdY: number;
      }>)
    : [];
}

async function tapRepeatedly(page: Page, count: number, intervalMs: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await page.touchscreen.tap(TAP_X, TAP_Y);
    await page.waitForTimeout(intervalMs);
  }
}

async function assertNoPageInterference(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollY: window.scrollY,
    scrollTop: document.scrollingElement?.scrollTop ?? 0,
    scale: window.visualViewport?.scale ?? 1,
  }));
  expect(metrics.scrollY).toBe(0);
  expect(metrics.scrollTop).toBe(0);
  expect(metrics.scale).toBe(1);
}

/**
 * Verifies the rendered pillar geometry against the authoritative obstacle
 * geometry by sampling actual pixels while a round is running. In E2E mode the
 * deterministic course puts the first gap at the bottom (634-844) and the
 * second gap at the top (0-210), so the left obstacle must show a pillar above
 * the gap and empty space inside it, and the right obstacle must show empty
 * space in the gap and a pillar below it.
 */
async function verifyRenderedObstacleGeometry(page: Page): Promise<void> {
  const isPillar = (rgb: number[]): boolean =>
    Math.hypot((rgb[0] ?? 0) - 157, (rgb[1] ?? 0) - 184, (rgb[2] ?? 0) - 201) < 40;

  for (let attempt = 0; attempt < 30; attempt++) {
    const shot = await page.screenshot();
    const b64 = shot.toString("base64");
    const info = await page.evaluate(
      async ({ b64 }) => {
        const app = document.querySelector("#app");
        const phase = app?.getAttribute("data-phase");
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const g = canvas.getContext("2d");
        if (!g) {
          throw new Error("2d context unavailable");
        }
        g.drawImage(img, 0, 0);
        const pixel = (x: number, y: number): number[] => {
          const d = g.getImageData(
            Math.round(x * (img.width / 390)),
            Math.round(y * (img.height / 844)),
            1,
            1,
          ).data;
          return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
        };
        const isPillar = (rgb: number[]): boolean =>
          Math.hypot((rgb[0] ?? 0) - 157, (rgb[1] ?? 0) - 184, (rgb[2] ?? 0) - 201) < 40;
        const columns: Array<[number, number]> = [];
        let inColumn = false;
        for (let x = 2; x < 388; x++) {
          const pillar = isPillar(pixel(x, 400));
          if (pillar && !inColumn) {
            inColumn = true;
            columns.push([x, x]);
          } else if (pillar && inColumn) {
            columns[columns.length - 1]![1] = x;
          } else {
            inColumn = false;
          }
        }
        const clusters: Array<{
          width: number;
          center: number;
          samples: {
            y500: number[];
            y739: number[];
            y105: number[];
            y300: number[];
            y700: number[];
          };
        }> = [];
        for (const column of columns) {
          const x0 = column[0] ?? 0;
          const x1 = column[1] ?? 0;
          if (x1 - x0 < 45) {
            continue;
          }
          const center = Math.round((x0 + x1) / 2);
          clusters.push({
            width: x1 - x0 + 1,
            center,
            samples: {
              y500: pixel(center, 500),
              y739: pixel(center, 739),
              y105: pixel(center, 105),
              y300: pixel(center, 300),
              y700: pixel(center, 700),
            },
          });
        }
        return { phase, clusters };
      },
      { b64 },
    );

    if (info.phase === "running" && info.clusters.length >= 2) {
      const [left, right] = info.clusters;
      if (!left || !right) {
        throw new Error("missing obstacle cluster");
      }
      const leftOk =
        isPillar(left.samples.y500) &&
        !isPillar(left.samples.y739) &&
        left.width >= 60;
      const rightOk =
        !isPillar(right.samples.y105) &&
        isPillar(right.samples.y300) &&
        isPillar(right.samples.y700) &&
        right.width >= 60;
      if (leftOk && rightOk) {
        return;
      }
    }
    await page.waitForTimeout(150);
  }
  throw new Error(
    "Rendered obstacle geometry does not match the authoritative gap positions",
  );
}

test("two phones share a course, tap independently and finish five rounds with a scoreboard", async ({
  browser,
}) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  await joinRoom(bob, "Bob", code);
  await waitForPlayers(alice, 2);
  await waitForPlayers(bob, 2);
  await expect(alice.locator("#start-button")).toBeVisible();
  await expect(bob.locator("#start-button")).toBeHidden();

  await alice.locator("#start-button").tap();
  await waitForPhase(alice, "countdown", 15_000);

  // Countdown shows the colour legend with every player.
  await expect(alice.locator("#countdown-overlay")).toBeVisible();
  await expect(alice.locator("#countdown-legend")).toContainText("Alice");
  await expect(alice.locator("#countdown-legend")).toContainText("Bob");
  await waitForPhase(bob, "countdown", 15_000);

  await waitForPhase(alice, "running", 15_000);
  await waitForPhase(bob, "running", 15_000);

  // Both clients receive the same authoritative course.
  const seedA = await dataset(alice, "course-seed");
  const seedB = await dataset(bob, "course-seed");
  const openingsA = await dataset(alice, "openings");
  const openingsB = await dataset(bob, "openings");
  const speedA = await dataset(alice, "course-speed");
  const speedB = await dataset(bob, "course-speed");
  expect(seedA).toBeTruthy();
  expect(seedA).toBe(seedB);
  expect(openingsA).toBe(openingsB);
  expect(speedA).toBe(speedB);

  // Every bird renders at the same size.
  expect(await dataset(alice, "bird-size")).toBe("34x30");
  expect(await dataset(bob, "bird-size")).toBe("34x30");

  // Both birds are active at the same horizontal position and pass through one
  // another (same x, overlapping y) without colliding.
  await alice.waitForFunction(
    () => {
      const raw = document.querySelector("#app")?.getAttribute("data-players");
      if (!raw) {
        return false;
      }
      const players = JSON.parse(raw) as Array<{ roundActive: boolean }>;
      return players.length === 2 && players.every((player) => player.roundActive);
    },
    undefined,
    { timeout: 10_000 },
  );

  // The rendered pillars must match the authoritative collision geometry.
  await verifyRenderedObstacleGeometry(alice);

  // Round 1: no taps -> both crash into the same obstacle and draw.
  await waitForRoundResult(alice, 1, 20_000);
  await waitForRoundResult(bob, 1, 20_000);
  expect(JSON.parse((await dataset(alice, "round-winners")) ?? "[]")).toHaveLength(2);
  const roundOneAlice = await playersSummary(alice);
  const roundOneBob = await playersSummary(bob);
  const alicePlayers = roundOneAlice;
  const bobPlayers = roundOneBob;
  expect(alicePlayers.find((p) => p.name === "Alice")?.roundWins).toBe(1);
  expect(alicePlayers.find((p) => p.name === "Bob")?.roundWins).toBe(1);
  expect(alicePlayers.every((p) => p.clearedObstacleCount === 1)).toBe(true);
  expect(bobPlayers.every((p) => p.clearedObstacleCount === 1)).toBe(true);

  // Round 2: Alice taps up and crashes at obstacle 1; Bob stays low, passes it
  // and wins. Taps land through the countdown and the opening of the round;
  // any taps that arrive during the brief round-1 result screen are ignored.
  const bobRoundTwoResult = waitForRoundResult(bob, 2, 25_000);
  const aliceSpectating = alice.waitForFunction(
    () => {
      const app = document.querySelector("#app");
      return (
        app?.getAttribute("data-round") === "2" && app?.getAttribute("data-spectating") === "true"
      );
    },
    undefined,
    { timeout: 25_000 },
  );
  const bobNotSpectating = bob.waitForFunction(
    () => {
      const app = document.querySelector("#app");
      return (
        app?.getAttribute("data-round") === "2" &&
        app?.getAttribute("data-phase") === "running" &&
        app?.getAttribute("data-spectating") === "false"
      );
    },
    undefined,
    { timeout: 25_000 },
  );
  await tapRepeatedly(alice, 16, 150);
  await assertNoPageInterference(alice);
  await aliceSpectating;
  await bobNotSpectating;
  const roundTwoWinnersHandle = await alice.waitForFunction(
    () => {
      const app = document.querySelector("#app");
      if (
        app?.getAttribute("data-phase") !== "round-result" ||
        app?.getAttribute("data-round") !== "2"
      ) {
        return undefined;
      }
      const raw = app?.getAttribute("data-round-winners");
      return raw ? JSON.parse(raw) : undefined;
    },
    undefined,
    { timeout: 25_000 },
  );
  await bobRoundTwoResult;
  const roundTwoWinners = (await roundTwoWinnersHandle.jsonValue()) as string[];
  expect(roundTwoWinners).toHaveLength(1);
  const roundTwoAlice = await playersSummary(alice);
  const aliceAfter = roundTwoAlice.find((p) => p.name === "Alice");
  const bobAfter = roundTwoAlice.find((p) => p.name === "Bob");
  expect(aliceAfter?.clearedObstacleCount).toBe(0);
  expect(bobAfter?.clearedObstacleCount).toBe(1);
  expect(aliceAfter?.roundWins).toBe(1);
  expect(bobAfter?.roundWins).toBe(2);

  // Rounds 3-4 draw; round 5 goes straight to the final scoreboard.
  for (let round = 3; round <= 4; round++) {
    await waitForRoundResult(alice, round, 20_000);
  }
  await alice.waitForFunction(
    () => {
      const app = document.querySelector("#app");
      return (
        app?.getAttribute("data-phase") === "finished" && app?.getAttribute("data-round") === "5"
      );
    },
    undefined,
    { timeout: 25_000 },
  );
  await bob.waitForFunction(
    () => {
      const app = document.querySelector("#app");
      return (
        app?.getAttribute("data-phase") === "finished" && app?.getAttribute("data-round") === "5"
      );
    },
    undefined,
    { timeout: 25_000 },
  );
  expect(await dataset(alice, "round")).toBe("5");

  // Final scoreboard: Bob 5, Alice 4; no sixth round.
  const leaderboard = JSON.parse((await dataset(alice, "result-leaderboard")) ?? "[]") as Array<{
    label: string;
    rank: number;
    primaryScore: number;
  }>;
  const bobEntry = leaderboard.find((entry) => entry.label === "Bob");
  const aliceEntry = leaderboard.find((entry) => entry.label === "Alice");
  expect(bobEntry?.primaryScore).toBe(5);
  expect(bobEntry?.rank).toBe(1);
  expect(aliceEntry?.primaryScore).toBe(4);
  expect(aliceEntry?.rank).toBe(2);
  await expect(alice.locator("#leaderboard .score-row").first()).toContainText("Bob");
  await alice.waitForTimeout(2_500);
  expect(await dataset(alice, "phase")).toBe("finished");
  expect(await dataset(alice, "round")).toBe("5");

  // The host can rematch through the shared platform flow.
  await alice.locator("#play-again-button").tap();
  await waitForPhase(alice, "lobby", 10_000);
  await waitForPhase(bob, "lobby", 10_000);
  await waitForPlayers(alice, 2);

  await alice.close();
  await bob.close();
});

test("five all-draw rounds keep the final scoreboard tied", async ({ browser }) => {
  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  await joinRoom(bob, "Bob", code);
  await waitForPlayers(alice, 2);
  await waitForPlayers(bob, 2);
  await alice.locator("#start-button").tap();

  await waitForPhase(alice, "finished", 60_000);
  await waitForPhase(bob, "finished", 60_000);
  expect(await dataset(alice, "round")).toBe("5");

  const winners = JSON.parse((await dataset(alice, "result-winners")) ?? "[]") as string[];
  expect(winners).toHaveLength(2);
  const leaderboard = JSON.parse((await dataset(alice, "result-leaderboard")) ?? "[]") as Array<{
    label: string;
    rank: number;
    primaryScore: number;
  }>;
  expect(leaderboard.every((entry) => entry.rank === 1)).toBe(true);
  expect(leaderboard.every((entry) => entry.primaryScore === 5)).toBe(true);

  // The final scoreboard stays visible with no tiebreaker and no sixth round.
  await alice.waitForTimeout(3_000);
  expect(await dataset(alice, "phase")).toBe("finished");
  expect(await dataset(alice, "round")).toBe("5");
  await expect(alice.locator("#results-screen")).toBeVisible();

  await alice.close();
  await bob.close();
});

test("runs on a desktop browser and a landscape phone without scrolling", async ({ browser }) => {
  const desktop = await browser.newPage();
  await desktop.setViewportSize({ width: 1280, height: 800 });
  const landscape = await openPhone(browser, { width: 844, height: 390 });

  await desktop.goto("/flappy-race/");
  await desktop.locator("#name-input").fill("Desktop");
  await desktop.locator("#create-button").click();
  await expect(desktop.locator("#lobby-code")).not.toBeEmpty({ timeout: 15_000 });
  const code = (await desktop.locator("#lobby-code").textContent()) ?? "";
  await joinRoom(landscape, "Landscape", code);
  await waitForPlayers(desktop, 2);

  await desktop.locator("#start-button").click();
  await waitForPhase(desktop, "countdown", 15_000);
  await waitForPhase(landscape, "countdown", 15_000);
  await expect(landscape.locator("#countdown-legend")).toContainText("Desktop");
  await expect(landscape.locator("#countdown-legend")).toContainText("Landscape");
  await waitForPhase(desktop, "running", 15_000);
  await waitForPhase(landscape, "running", 15_000);

  const canvas = landscape.locator("#game-container canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  }
  await tapRepeatedly(landscape, 6, 120);
  await assertNoPageInterference(landscape);
  await assertNoPageInterference(desktop);

  await waitForPhase(landscape, "round-result", 20_000);
  await expect(landscape.locator("#round-result-overlay")).toBeVisible();

  await desktop.close();
  await landscape.close();
});
