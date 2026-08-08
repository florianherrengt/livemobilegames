import { KART_RACING_TRACK, nearestRoadPoint, pointAlongCenterline } from "@phone-party/protocol";
import { type Browser, expect, type Page, test } from "@playwright/test";

async function openPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(() => {
    window.sessionStorage.setItem("kart-racing-e2e-driver", "1");
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
  return page.getByTestId("kart-racing-arena");
}

async function waitForPhase(page: Page, phase: string, timeout = 20_000): Promise<void> {
  await expect(arena(page)).toHaveAttribute("data-phase", phase, { timeout });
}

function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) {
    result -= Math.PI * 2;
  }
  while (result < -Math.PI) {
    result += Math.PI * 2;
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nearestCenterlineIndex(x: number, y: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < KART_RACING_TRACK.centerline.length; index++) {
    const point = KART_RACING_TRACK.centerline[index] ?? { x: 0, y: 0 };
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

type DriveStats = {
  races: Set<number>;
  resultRaces: Set<number>;
  maxLap: number;
  maxCheckpoint: number;
  maxSpeed: number;
  shots: number;
  sawAmmo: boolean;
  sawProjectile: boolean;
  sawRespawn: boolean;
};

/** Drives one real phone through every race using ordinary steer/shoot intents. */
async function drivePage(page: Page, maxMs: number): Promise<DriveStats> {
  const startedAt = Date.now();
  let lastShootAt = 0;
  const stats: DriveStats = {
    races: new Set(),
    resultRaces: new Set(),
    maxLap: 0,
    maxCheckpoint: 0,
    maxSpeed: 0,
    shots: 0,
    sawAmmo: false,
    sawProjectile: false,
    sawRespawn: false,
  };
  while (Date.now() - startedAt < maxMs) {
    if ((await page.getByTestId("kart-racing-leaderboard").count()) > 0) {
      return stats;
    }
    if ((await arena(page).count()) === 0) {
      const resultHeading = page.getByRole("heading", { name: /^Race \d+ result$/ });
      if ((await resultHeading.count()) > 0) {
        const race = Number((await resultHeading.textContent())?.match(/\d+/)?.[0] ?? 0);
        if (race > 0) {
          stats.resultRaces.add(race);
        }
      }
      await page.waitForTimeout(80);
      continue;
    }
    const snapshot = await arena(page).evaluate((element) => ({
      phase: element.dataset.phase ?? "",
      race: Number(element.dataset.race ?? 0),
      x: Number(element.dataset.localX ?? 0),
      y: Number(element.dataset.localY ?? 0),
      heading: Number(element.dataset.localHeading ?? 0),
      speed: Number(element.dataset.localSpeed ?? 0),
      lap: Number(element.dataset.localLap ?? 0),
      checkpoint: Number(element.dataset.localCheckpoint ?? 0),
      ammo: element.dataset.localAmmo === "true",
      projectileCount: Number(element.dataset.projectileCount ?? 0),
      respawn: Number(element.dataset.localRespawn ?? 0),
    }));
    stats.races.add(snapshot.race);
    stats.maxLap = Math.max(stats.maxLap, snapshot.lap);
    stats.maxCheckpoint = Math.max(stats.maxCheckpoint, snapshot.checkpoint);
    stats.maxSpeed = Math.max(stats.maxSpeed, snapshot.speed);
    stats.sawAmmo ||= snapshot.ammo;
    stats.sawProjectile ||= snapshot.projectileCount > 0;
    stats.sawRespawn ||= snapshot.respawn > 0;

    const phase = snapshot.phase;
    if (phase === "countdown" || phase === "racing") {
      const { x, y, heading } = snapshot;
      const nearest = nearestRoadPoint(KART_RACING_TRACK, { x, y });
      const target = pointAlongCenterline(
        KART_RACING_TRACK,
        nearestCenterlineIndex(nearest.x, nearest.y),
        150,
      );
      const targetX = target.x;
      const targetY = target.y;
      const desired = Math.atan2(targetY - y, targetX - x);
      const hx = Math.cos(heading);
      const hy = Math.sin(heading);
      let avoidance: number | null = null;
      for (const obstacle of KART_RACING_TRACK.obstacles) {
        const dx = obstacle.x - x;
        const dy = obstacle.y - y;
        const ahead = dx * hx + dy * hy;
        if (ahead < 0 || ahead > 160) {
          continue;
        }
        const lateral = -dx * hy + dy * hx;
        if (Math.abs(lateral) < obstacle.radius + 40) {
          avoidance = lateral > 0 ? -1 : 1;
          break;
        }
      }
      const steering =
        avoidance === null ? clamp(normalizeAngle(desired - heading) * 1.8, -1, 1) : avoidance;
      await page.evaluate((value) => {
        const drive = (
          window as unknown as {
            __kartRacingDrive?: { steer: (steering: number) => void };
          }
        ).__kartRacingDrive;
        drive?.steer(value);
      }, steering);

      if (snapshot.ammo && Date.now() - lastShootAt > 4_000) {
        await page.evaluate(() => {
          const drive = (
            window as unknown as {
              __kartRacingDrive?: { shoot: () => void };
            }
          ).__kartRacingDrive;
          drive?.shoot();
        });
        lastShootAt = Date.now();
        stats.shots += 1;
      }
      await page.waitForTimeout(80);
    } else {
      await page.evaluate(() => {
        const drive = (
          window as unknown as {
            __kartRacingDrive?: { steer: (steering: number) => void };
          }
        ).__kartRacingDrive;
        drive?.steer(0);
      });
      await page.waitForTimeout(80);
    }
  }
  throw new Error(`Kart Racing did not finish within ${maxMs}ms`);
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

test("two phones complete all three Kart Racing races with authoritative results", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });

  await alice.getByRole("combobox", { name: "Choose a game" }).click();
  await alice.getByRole("option", { name: "Kart Racing" }).click();
  await alice.getByRole("button", { name: "Start game" }).click();

  await waitForPhase(alice, "countdown");
  await waitForPhase(bob, "countdown");
  await expect(alice.getByText("How to play Kart Racing")).toBeVisible();
  await waitForPhase(alice, "racing", 15_000);
  await waitForPhase(bob, "racing", 15_000);
  await expect(alice.getByText("How to play Kart Racing")).not.toBeVisible();

  // The server rejects a forged shoot intent before a crate has supplied ammo.
  await expect(arena(alice)).toHaveAttribute("data-local-ammo", "false");
  await alice.evaluate(() => {
    (
      window as unknown as {
        __kartRacingDrive?: { shoot: () => void };
      }
    ).__kartRacingDrive?.shoot();
  });
  await expect(alice.getByText("No ammo — collect a crate.")).toBeVisible();

  // A third independent browser cannot join the locked running game.
  const carol = await openPhone(browser);
  await carol.goto("/");
  await carol.locator("#room-code").fill(code);
  await carol.locator("#join-player-name").fill("Carol");
  await carol.getByRole("button", { name: "Join room" }).click();
  await expect(carol.getByRole("alert")).toContainText(/cannot accept new players/i);
  await carol.close();

  // A dropped kart reconnects under the same session and enters the
  // authoritative respawn path before continuing the race.
  const bobSessionId = await arena(bob).getAttribute("data-self-session");
  await dropSocketAndObserveReconnect(bob);
  await expect(arena(bob)).toHaveAttribute("data-self-session", bobSessionId ?? "", {
    timeout: 10_000,
  });
  await expect(arena(bob)).toHaveAttribute("data-local-connection", "connected");
  await arena(bob).waitForFunction(
    (element) => Number(element.dataset.localRespawn ?? 0) > 0,
    null,
    { timeout: 5_000 },
  );

  const [aliceStats, bobStats] = await Promise.all([
    drivePage(alice, 130_000),
    drivePage(bob, 130_000),
  ]);

  await expect(alice.getByTestId("kart-racing-leaderboard")).toBeVisible();
  await expect(bob.getByTestId("kart-racing-leaderboard")).toBeVisible();
  const aliceRows = alice.getByTestId("kart-racing-leaderboard").locator("li");
  const bobRows = bob.getByTestId("kart-racing-leaderboard").locator("li");
  await expect(aliceRows).toHaveCount(2);
  await expect(bobRows).toHaveCount(2);
  expect(await aliceRows.allTextContents()).toEqual(await bobRows.allTextContents());
  const totalPoints = (await aliceRows.allTextContents()).reduce((total, row) => {
    const points = row.match(/(\d+) pts/)?.[1];
    return total + Number(points ?? 0);
  }, 0);
  expect(totalPoints).toBe(42);
  expect([...aliceStats.races].sort()).toEqual([1, 2, 3]);
  expect([...bobStats.races].sort()).toEqual([1, 2, 3]);
  expect([...aliceStats.resultRaces].sort()).toEqual([1, 2, 3]);
  expect([...bobStats.resultRaces].sort()).toEqual([1, 2, 3]);
  expect(aliceStats.maxSpeed).toBeGreaterThan(0);
  expect(bobStats.maxSpeed).toBeGreaterThan(0);
  expect(aliceStats.maxLap > 1 || aliceStats.maxCheckpoint > 0).toBe(true);
  expect(bobStats.maxLap > 1 || bobStats.maxCheckpoint > 0).toBe(true);
  expect(aliceStats.shots + bobStats.shots).toBeGreaterThan(0);
  expect(aliceStats.sawAmmo || bobStats.sawAmmo).toBe(true);
  expect(aliceStats.sawProjectile || bobStats.sawProjectile).toBe(true);
  await expect(bob.getByText("Waiting for the host to play again…")).toBeVisible();

  // Host rematch resets both phones to race one.
  await alice.getByRole("button", { name: "Play again" }).click();
  await waitForPhase(alice, "countdown", 15_000);
  await waitForPhase(bob, "countdown", 15_000);
  await expect(arena(alice)).toHaveAttribute("data-race", "1");
  await expect(arena(bob)).toHaveAttribute("data-race", "1");

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
