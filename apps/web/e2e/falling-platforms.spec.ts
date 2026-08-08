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

async function swipeRight(page: Page): Promise<void> {
  const arena = page.getByTestId("falling-platforms-arena");
  // The swipe is dispatched on the arena itself with the same pointer
  // sequence the browser produces for a touch drag; coordinates stay inside
  // the viewport so the gesture is independent of the fitted arena transform.
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

async function expectPlatformVisible(page: Page, platformId: string): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const arena = document.querySelector('[data-testid="falling-platforms-arena"]');
      const platform = document.querySelector(`[data-testid="platform-${id}"]`);
      if (!arena || !platform) {
        return false;
      }
      const arenaBox = arena.getBoundingClientRect();
      const platformBox = platform.getBoundingClientRect();
      return (
        platformBox.x >= arenaBox.x - 1 &&
        platformBox.y >= arenaBox.y - 1 &&
        platformBox.x + platformBox.width <= arenaBox.x + arenaBox.width + 1 &&
        platformBox.y + platformBox.height <= arenaBox.y + arenaBox.height + 1
      );
    },
    platformId,
    { timeout: 5_000 },
  );
  const arenaBox = await page.getByTestId("falling-platforms-arena").boundingBox();
  const platformBox = await page.getByTestId(`platform-${platformId}`).boundingBox();
  expect(arenaBox).not.toBeNull();
  expect(platformBox).not.toBeNull();
}

async function expectPlatformLarge(page: Page, platformId: string): Promise<void> {
  const platformBox = await page.getByTestId(`platform-${platformId}`).boundingBox();
  expect(platformBox).not.toBeNull();
  if (!platformBox) {
    return;
  }
  expect(platformBox.width).toBeGreaterThan(100);
  expect(platformBox.height).toBeGreaterThan(100);
}

async function expectArenaResized(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const arena = document.querySelector('[data-testid="falling-platforms-arena"]');
    if (!arena) {
      return false;
    }
    const rect = arena.getBoundingClientRect();
    return rect.width <= window.innerWidth + 1 && rect.height <= window.innerHeight + 1;
  });
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

test("two phones finish, reconnect, and finish a Falling Platforms rematch", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const alice = await openPhone(browser);
  const bob = await openPhone(browser);

  const code = await createRoom(alice, "Alice");
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  await joinRoom(bob, "Bob", code);
  await expect(alice.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText(/Players \(2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(alice.getByText("Alice (you)", { exact: true })).toBeVisible();
  await expect(bob.getByText("Bob (you)", { exact: true })).toBeVisible();

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
    "5",
  );
  await expectPlatformVisible(alice, "3:3");
  await expectPlatformLarge(alice, "3:3");
  await expectPlatformVisible(bob, "3:4");
  await expectPlatformLarge(bob, "3:4");
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-alive-count",
    "2",
  );
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-local-platform",
    "3:3",
  );
  await expect(alice.getByText("How to play Falling Platforms")).not.toBeVisible();
  await expect(bob.getByText("How to play Falling Platforms")).not.toBeVisible();
  await expect(bob.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-local-platform",
    "3:4",
  );
  await expect(alice.getByTestId("player-Alice")).toHaveAttribute("data-local", "true");
  await expect(bob.getByTestId("player-Bob")).toHaveAttribute("data-local", "true");

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
  await expectPlatformVisible(alice, "4:3");
  await expectPlatformLarge(alice, "4:3");

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

  // The room is now old enough for a real Colyseus reconnect. Alice drops her
  // game socket, resumes the same second round, then makes a hop which Bob
  // observes from his independent phone.
  await dropSocketAndObserveReconnect(alice);
  await expect(alice.getByTestId("player-Alice")).toHaveAttribute("data-local", "true");
  await swipeRight(alice);
  await expect(alice.getByTestId("falling-platforms-arena")).toHaveAttribute(
    "data-local-platform",
    "4:3",
    { timeout: 10_000 },
  );
  await expect(bob.getByTestId("player-Alice")).toHaveAttribute("data-platform", "4:3", {
    timeout: 10_000,
  });

  // Bob is eliminated by the deterministic first collapse again, proving the
  // post-reconnect rematch also reaches its intended end state on both phones.
  await expect(bob.getByTestId("platform-3:4")).toHaveAttribute("data-state", "warning", {
    timeout: 10_000,
  });
  await expect(bob.getByTestId("player-Bob")).toHaveAttribute("data-alive", "false", {
    timeout: 10_000,
  });
  await expect(alice.getByText("Alice wins!")).toBeVisible({ timeout: 10_000 });
  await expect(bob.getByText("Alice wins!")).toBeVisible({ timeout: 10_000 });

  // The arena stays usable at the 320px minimum width without horizontal page
  // scroll while the authoritative result overlays the surviving platform.
  for (const page of [alice, bob]) {
    await page.setViewportSize({ width: 320, height: 568 });
    await expectArenaResized(page);
    await expectPlatformVisible(page, "4:3");
    await expectPlatformLarge(page, "4:3");
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noHorizontalScroll).toBe(true);
  }

  await Promise.all([alice.context().close(), bob.context().close()]);
});
