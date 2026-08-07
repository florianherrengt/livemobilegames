import { KART_RACING_TRACK, nearestRoadPoint, pointAlongCenterline } from "@phone-party/protocol";
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

async function readNumber(page: Page, attribute: string): Promise<number> {
  const value = await arena(page).getAttribute(attribute);
  return Number(value ?? 0);
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

/**
 * A scripted phone player: reads the public track lookahead the renderer
 * exposes, converts it to a steering offset, and drives through the game's
 * automation hook, which sends exactly the same intent messages the touch
 * controls send. Touch/swipe recognition itself is covered by component
 * tests; this exercises the full authoritative server loop in real browsers.
 */
async function drivePage(page: Page, maxMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastShootAt = 0;
  while (Date.now() - startedAt < maxMs) {
    const phase = await arena(page).getAttribute("data-phase");
    if (phase === "finished") {
      break;
    }
    if (phase === "countdown" || phase === "racing") {
      const x = await readNumber(page, "data-local-x");
      const y = await readNumber(page, "data-local-y");
      const heading = await readNumber(page, "data-local-heading");
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

      const ammo = (await arena(page).getAttribute("data-local-ammo")) === "true";
      if (ammo && Date.now() - lastShootAt > 4_000) {
        await page.evaluate(() => {
          const drive = (
            window as unknown as {
              __kartRacingDrive?: { shoot: () => void };
            }
          ).__kartRacingDrive;
          drive?.shoot();
        });
        lastShootAt = Date.now();
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
}

test("two phones start a Kart Racing match with synced state and working controls", async ({
  browser,
}) => {
  test.setTimeout(120_000);

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

  // Drive both phones through the live authoritative loop for a bounded
  // period. The scripted driver exercises steering and shooting intents; the
  // full three-race match and final results are covered by the real-client
  // integration suite, which is more deterministic than browser pointer
  // automation.
  await Promise.all([drivePage(alice, 20_000), drivePage(bob, 20_000)]);

  const aliceRace = await arena(alice).getAttribute("data-race");
  const bobRace = await arena(bob).getAttribute("data-race");
  expect(aliceRace).toBe(bobRace);
  expect(aliceRace).not.toBeNull();
  const alicePosition = await arena(alice).getAttribute("data-local-position");
  const bobPosition = await arena(bob).getAttribute("data-local-position");
  expect(["1", "2"]).toContain(alicePosition);
  expect(["1", "2"]).toContain(bobPosition);
  const alicePhase = await arena(alice).getAttribute("data-phase");
  expect(["racing", "race-result", "countdown"]).toContain(alicePhase);
  const bobPhase = await arena(bob).getAttribute("data-phase");
  expect(["racing", "race-result", "countdown"]).toContain(bobPhase);

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
