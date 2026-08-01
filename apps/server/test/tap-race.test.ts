import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { TapRaceState } from "@falling-platforms/tap-race";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
  description = "condition",
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function connect(
  colyseus: ColyseusTestServer,
  room: Awaited<ReturnType<ColyseusTestServer["createRoom"]>>,
  options: { name: string },
) {
  const client = await colyseus.connectTo(room, options);
  await waitFor(
    () => client.state !== undefined && client.state.players !== undefined,
    5_000,
    "client initial state",
  );
  return client;
}

async function ready(client: { send: (type: string, payload: unknown) => void }, id: string) {
  client.send("platform:set-ready", { ready: true, requestId: `${id}-ready` });
}

async function startGame(client: { send: (type: string, payload: unknown) => void }, id: string) {
  client.send("platform:start", { requestId: `${id}-start` });
}

describe("tap race room integration", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    process.env.E2E_TEST_MODE = "true";
    process.env.RECONNECT_GRACE_MS = "1000";
    const { appConfig } = await import("../src/app.config.js");
    colyseus = await boot(appConfig);
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("runs the full lobby, match and play-again flow", async () => {
    const room = await colyseus.createRoom("tap_race", {});
    expect(room.roomId).toMatch(ROOM_CODE_PATTERN);

    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");

    expect(room.state.hostSessionId).toBe(alice.sessionId);
    expect(room.state.players.get(alice.sessionId)?.isHost).toBe(true);

    // Tapping before the match starts is rejected with a typed error.
    alice.send("game:command", { command: { type: "tap" }, requestId: "early-tap" });
    const early = await alice.waitForMessage("platform:command-result", 5_000);
    expect(early.ok).toBe(false);
    expect(early.error.code).toBe("GAME_NOT_RUNNING");

    // The host cannot start while players are unready.
    startGame(alice, "alice");
    const unready = await alice.waitForMessage("platform:command-result", 5_000);
    expect(unready.ok).toBe(false);
    expect(unready.error.code).toBe("PLAYERS_NOT_READY");

    ready(alice, "alice");
    ready(bob, "bob");
    await waitFor(
      () =>
        room.state.players.get(alice.sessionId)?.isReady === true &&
        room.state.players.get(bob.sessionId)?.isReady === true,
      5_000,
      "both players ready",
    );

    // Bob cannot start because Bob is not the host.
    startGame(bob, "bob");
    const notHost = await bob.waitForMessage("platform:command-result", 5_000);
    expect(notHost.ok).toBe(false);
    expect(notHost.error.code).toBe("NOT_HOST");

    startGame(alice, "alice");
    const started = await alice.waitForMessage("platform:command-result", 5_000);
    expect(started.ok).toBe(true);
    await waitFor(() => room.state.phase === "countdown", 5_000, "countdown phase");

    // Countdown ends through the server timer.
    room.clock.tick(room.clock.currentTime + 600);
    await waitFor(() => room.state.phase === "playing", 5_000, "playing phase");

    // Server records authoritative scores.
    for (let index = 0; index < 3; index++) {
      alice.send("game:command", { command: { type: "tap" } });
    }
    bob.send("game:command", { command: { type: "tap" } });
    await waitFor(
      () => (room.state.players.get(alice.sessionId)?.score ?? 0) >= 3,
      5_000,
      "alice score",
    );
    expect(room.state.players.get(bob.sessionId)?.score).toBe(1);

    // The match ends through a server timer and results are broadcast.
    room.clock.tick(room.clock.currentTime + 2_100);
    await waitFor(() => room.state.status === "finished", 5_000, "finished status");
    expect(room.state.phase).toBe("finished");
    const result = (room.state as TapRaceState).result;
    expect(result?.leaderboard[0]?.sessionId).toBe(alice.sessionId);
    expect(result ? [...result.winnerSessionIds] : []).toEqual([alice.sessionId]);

    // Only the host can play again.
    bob.send("platform:play-again", { requestId: "bob-again" });
    const notHostAgain = await bob.waitForMessage("platform:command-result", 5_000);
    expect(notHostAgain.ok).toBe(false);
    expect(notHostAgain.error.code).toBe("NOT_HOST");

    alice.send("platform:play-again", { requestId: "alice-again" });
    const again = await alice.waitForMessage("platform:command-result", 5_000);
    expect(again.ok).toBe(true);
    await waitFor(
      () => room.state.status === "lobby" && room.state.phase === "lobby",
      5_000,
      "back to lobby",
    );
    expect(room.state.players.get(alice.sessionId)?.score).toBe(0);
    expect(room.state.players.get(alice.sessionId)?.isReady).toBe(false);
  });

  it("enforces the maximum player count", async () => {
    const room = await colyseus.createRoom("tap_race", {});
    const clients = [];
    for (let index = 0; index < 20; index++) {
      clients.push(await connect(colyseus, room, { name: `P${index}` }));
    }
    await waitFor(() => room.state.players.size === 20, 10_000, "twenty players");
    await expect(colyseus.sdk.joinById(room.roomId, { name: "Overflow" })).rejects.toThrow();
    expect(room.state.players.size).toBe(20);
  });

  it("restores the same identity and exact state after reconnection", async () => {
    const room = await colyseus.createRoom("tap_race", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    const bobSessionId = bob.sessionId;
    const bobToken = bob.reconnectionToken;

    ready(alice, "alice");
    ready(bob, "bob");
    await waitFor(
      () =>
        room.state.players.get(alice.sessionId)?.isReady === true &&
        room.state.players.get(bob.sessionId)?.isReady === true,
      5_000,
      "ready",
    );
    startGame(alice, "alice");
    await waitFor(() => room.state.phase === "playing", 5_000, "playing");

    // Bob disconnects while the match is running.
    bob.connection.close();
    await waitFor(
      () => room.state.players.get(bobSessionId)?.connectionStatus === "reconnecting",
      5_000,
      "bob reconnecting",
    );

    // Alice keeps playing while Bob is away, so state changes offline.
    for (let index = 0; index < 5; index++) {
      alice.send("game:command", { command: { type: "tap" } });
    }
    await waitFor(
      () => (room.state.players.get(alice.sessionId)?.score ?? 0) >= 5,
      5_000,
      "alice taps while bob is away",
    );

    const reconnected = await colyseus.sdk.reconnect(bobToken);
    expect(reconnected.sessionId).toBe(bobSessionId);
    await waitFor(
      () =>
        reconnected.state !== undefined &&
        reconnected.state.players !== undefined &&
        reconnected.state.players.get(bobSessionId)?.connectionStatus === "connected",
      5_000,
      "bob connected again",
    );
    // Bob exactly catches up to the latest server state, including Alice's
    // offline taps.
    await waitFor(
      () => {
        const clientState = reconnected.state;
        const serverState = room.state;
        if (clientState?.players === undefined) {
          return false;
        }
        return (
          clientState.phase === serverState.phase &&
          clientState.players.get(alice.sessionId)?.score ===
            serverState.players.get(alice.sessionId)?.score
        );
      },
      5_000,
      "reconnected client catches up exactly",
    );
    expect(room.state.players.size).toBe(2);
  });

  it("removes a player after the reconnection grace period expires", async () => {
    const room = await colyseus.createRoom("tap_race", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    const bobSessionId = bob.sessionId;
    const bobToken = bob.reconnectionToken;

    bob.connection.close();
    await waitFor(
      () => room.state.players.get(bobSessionId)?.connectionStatus === "reconnecting",
      5_000,
      "bob reconnecting",
    );
    await waitFor(() => room.state.players.size === 1, 10_000, "bob removed after grace");

    // A later reconnection does not restore the previous room membership.
    await expect(colyseus.sdk.reconnect(bobToken)).rejects.toThrow();
    expect(room.state.players.size).toBe(1);
    expect(alice.sessionId).toBeTruthy();
  });

  it("rate limits game commands", async () => {
    const room = await colyseus.createRoom("tap_race", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    ready(alice, "alice");
    ready(bob, "bob");
    await waitFor(() => room.state.players.get(alice.sessionId)?.isReady === true, 5_000, "ready");
    startGame(alice, "alice");
    await waitFor(() => room.state.phase === "playing", 5_000, "playing");

    for (let index = 0; index < 25; index++) {
      alice.send("game:command", { command: { type: "tap" } });
    }
    await waitFor(
      () => (room.state.players.get(alice.sessionId)?.score ?? 0) >= 20,
      5_000,
      "score reaches the rate limit",
    );
    expect(room.state.players.get(alice.sessionId)?.score).toBe(20);
  });

  it("rejects malformed lobby commands and answers time sync", async () => {
    const room = await colyseus.createRoom("tap_race", {});
    const alice = await connect(colyseus, room, { name: "Alice" });

    alice.send("platform:start", {});
    const malformed = await alice.waitForMessage("platform:error", 5_000);
    expect(malformed.error.code).toBe("INVALID_REQUEST");
    expect(malformed.operation).toBe("room.start");

    const sentAt = Date.now();
    alice.send("platform:time-sync", { requestId: "ts-1", sentAt });
    const sync = await alice.waitForMessage("platform:time-sync", 5_000);
    expect(sync.requestId).toBe("ts-1");
    expect(sync.serverTime).toBeGreaterThan(sentAt - 5_000);
    expect(sync.serverTime).toBeLessThan(sentAt + 5_000);
  });

  it("allocates unique room codes for active rooms", async () => {
    const first = await colyseus.createRoom("tap_race", {});
    const second = await colyseus.createRoom("tap_race", {});
    expect(first.roomId).not.toBe(second.roomId);
    expect(first.roomId).toMatch(ROOM_CODE_PATTERN);
    expect(second.roomId).toMatch(ROOM_CODE_PATTERN);
  });
});
