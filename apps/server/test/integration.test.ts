import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { FallingPlatformsState } from "@falling-platforms/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

async function connect(
  colyseus: ColyseusTestServer,
  room: Awaited<ReturnType<ColyseusTestServer["createRoom"]>>,
  options: { name: string },
): Promise<Awaited<ReturnType<ColyseusTestServer["connectTo"]>>> {
  const client = await colyseus.connectTo(room, options);
  await waitFor(
    () => client.state !== undefined && client.state.players !== undefined,
    5_000,
    "client initial state",
  );
  return client;
}

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
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

describe("room integration", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    process.env.E2E_TEST_MODE = "true";
    const { appConfig } = await import("../src/app.config.js");
    colyseus = await boot(appConfig);
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("creates a room joinable through its private code", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    expect(room.roomId).toMatch(ROOM_CODE_PATTERN);

    const client = await connect(colyseus, room, { name: "Alice" });
    expect(client.state.roomCode).toBe(room.roomId);
    expect(client.state.players.get(client.sessionId)?.name).toBe("Alice");
    expect(client.state.hostSessionId).toBe(client.sessionId);
    expect(client.state.phase).toBe("lobby");
  });

  it("joins with two clients who see the same lobby", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });

    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    await waitFor(() => alice.state.players.size === 2, 5_000, "alice sees two players");
    await waitFor(() => bob.state.players.size === 2, 5_000, "bob sees two players");
    expect(room.state.hostSessionId).toBe(alice.sessionId);
  });

  it("only lets the host start the match", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");

    bob.send("platform:start", { requestId: "bob-start" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(room.state.phase).toBe("lobby");

    alice.send("platform:start", { requestId: "alice-start" });
    await waitFor(() => room.state.phase === "countdown", 5_000, "countdown");
    await waitFor(
      () => alice.state.phase === "countdown" && bob.state.phase === "countdown",
      5_000,
      "both clients in countdown",
    );
  });

  it("runs a full deterministic match: hops, rejections, elimination, winner, next round", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");

    alice.send("platform:start", { requestId: "alice-start" });
    await waitFor(() => room.state.phase === "playing", 10_000, "playing phase");
    await waitFor(
      () => alice.state.phase === "playing" && bob.state.phase === "playing",
      10_000,
      "both clients playing",
    );

    // E2E mode uses the known spawn layout.
    expect(room.state.players.get(alice.sessionId)?.currentPlatformId).toBe("3:3");
    expect(room.state.players.get(bob.sessionId)?.currentPlatformId).toBe("3:4");
    expect(alice.state.platforms.size).toBe(49);
    expect(bob.state.platforms.size).toBe(49);

    // An accepted hop updates authoritative state and both clients.
    alice.send("game:command", {
      command: { type: "hop", sequence: 1, targetPlatformId: "4:4" },
    });
    await waitFor(
      () => room.state.players.get(alice.sessionId)?.currentPlatformId === "4:4",
      10_000,
      "alice lands on 4:4",
    );
    await waitFor(
      () => alice.state.players.get(alice.sessionId)?.currentPlatformId === "4:4",
      10_000,
      "alice client sees landing",
    );
    expect(bob.state.players.get(alice.sessionId)?.currentPlatformId).toBe("4:4");

    // An invalid hop is rejected with a machine-readable reason.
    bob.send("game:command", {
      command: { type: "hop", sequence: 1, targetPlatformId: "0:0" },
    });
    const rejection = await bob.waitForMessage("hop-rejected", 5_000);
    expect(rejection.reason).toBe("not-adjacent");
    expect(rejection.sequence).toBe(1);

    // Bob's platform is the deterministic first removal target.
    await waitFor(() => room.state.platforms.get("3:4")?.state === "warning", 10_000, "3:4 warns");
    await waitFor(
      () => bob.state.platforms.get("3:4")?.state === "warning",
      10_000,
      "bob sees 3:4 warning",
    );
    await waitFor(
      () => room.state.platforms.get("3:4")?.state === "gone",
      10_000,
      "3:4 disappears",
    );

    // Bob stands still, so the disappearing platform eliminates him.
    await waitFor(
      () => room.state.players.get(bob.sessionId)?.alive === false,
      10_000,
      "bob eliminated",
    );
    await waitFor(
      () => alice.state.players.get(bob.sessionId)?.alive === false,
      10_000,
      "alice sees bob eliminated",
    );

    // Alice is the last survivor.
    await waitFor(() => room.state.phase === "results", 10_000, "results phase");
    expect(room.state.winnerSessionId).toBe(alice.sessionId);
    expect(room.state.draw).toBe(false);
    await waitFor(
      () => alice.state.phase === "results" && bob.state.phase === "results",
      10_000,
      "both clients see results",
    );
    expect(alice.state.winnerSessionId).toBe(alice.sessionId);

    // Everyone returns to the same lobby, then a second round can start.
    await waitFor(() => room.state.phase === "lobby", 10_000, "back to lobby");
    expect(room.state.players.size).toBe(2);
    expect(room.state.platforms.size).toBe(0);
    alice.send("platform:start", { requestId: "alice-start" });
    await waitFor(() => room.state.phase === "playing", 10_000, "second round playing");
    expect(alice.state.arenaSide).toBe(7);
  });

  it("lets a late joiner spectate an active match", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const _bob = await colyseus.connectTo(room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");

    alice.send("platform:start", { requestId: "alice-start" });
    await waitFor(() => room.state.phase === "playing", 10_000, "playing phase");

    const carol = await connect(colyseus, room, { name: "Carol" });
    const carolState = carol.state.players.get(carol.sessionId);
    expect(carolState?.participating).toBe(false);
    expect(carolState?.alive).toBe(false);
    expect(carol.state.phase).toBe("playing");
    expect(carol.state.platforms.size).toBe(49);
  });

  it("restores the same player on reconnection", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const sessionId = alice.sessionId;
    const token = alice.reconnectionToken;

    alice.connection.close();
    await waitFor(
      () => room.state.players.get(sessionId)?.connected === false,
      5_000,
      "player marked disconnected",
    );

    const reconnected = await colyseus.sdk.reconnect(token);
    await waitFor(
      () => room.state.players.get(sessionId)?.connected === true,
      5_000,
      "player reconnected",
    );
    expect(reconnected.sessionId).toBe(sessionId);
    expect(room.state.players.size).toBe(1);
    expect(room.state.players.get(sessionId)?.name).toBe("Alice");
  });

  it("reassigns the host when the host leaves", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    expect(room.state.hostSessionId).toBe(alice.sessionId);

    await alice.leave();
    await waitFor(() => room.state.hostSessionId === bob.sessionId, 5_000, "host reassigned");
    await waitFor(() => bob.state.hostSessionId === bob.sessionId, 5_000, "bob sees host change");
  });

  it("rejects a hop onto a platform another player occupies", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    alice.send("platform:start", { requestId: "alice-start" });
    await waitFor(() => room.state.phase === "playing", 10_000, "playing phase");

    // Spawns are Alice 3:3 and Bob 3:4; Bob stands on 3:4.
    alice.send("game:command", {
      command: { type: "hop", sequence: 1, targetPlatformId: "3:4" },
    });
    const rejection = await alice.waitForMessage("hop-rejected", 5_000);
    expect(rejection.reason).toBe("target-occupied");
    expect(room.state.players.get(alice.sessionId)?.currentPlatformId).toBe("3:3");
  });

  it("lets only the first player claim a free platform", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    alice.send("platform:start", { requestId: "alice-start" });
    await waitFor(() => room.state.phase === "playing", 10_000, "playing phase");

    // Both players are adjacent to 4:3. Alice commits first, Bob must be
    // rejected while Alice is still in flight.
    alice.send("game:command", {
      command: { type: "hop", sequence: 1, targetPlatformId: "4:3" },
    });
    await waitFor(
      () => room.state.players.get(alice.sessionId)?.jumping === true,
      5_000,
      "alice airborne to 4:3",
    );
    bob.send("game:command", {
      command: { type: "hop", sequence: 1, targetPlatformId: "4:3" },
    });
    const rejection = await bob.waitForMessage("hop-rejected", 5_000);
    expect(rejection.reason).toBe("target-occupied");
    expect(room.state.players.get(bob.sessionId)?.currentPlatformId).toBe("3:4");
  });

  it("declares a draw when both players are eliminated in the same update", async () => {
    const room = await colyseus.createRoom("falling_platforms", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    alice.send("platform:start", { requestId: "alice-start" });
    await waitFor(() => room.state.phase === "playing", 10_000, "playing phase");

    // Force both spawn platforms to disappear in the same server update, so
    // both grounded players are eliminated before the result is evaluated.
    const runtime = (room.state as FallingPlatformsState).runtime;
    if (!runtime) {
      throw new Error("missing falling platforms runtime");
    }
    const now = Date.now();
    for (const id of ["3:3", "3:4"]) {
      const platform = runtime.platforms.get(id);
      if (platform) {
        platform.state = "warning";
        platform.goneAt = now;
      }
    }

    await waitFor(() => room.state.phase === "results", 10_000, "results phase");
    expect(room.state.draw).toBe(true);
    expect(room.state.winnerSessionId).toBe("");
    expect(room.state.aliveCount).toBe(0);
    await waitFor(
      () => alice.state.draw === true && bob.state.draw === true,
      10_000,
      "both clients see the draw",
    );
    await waitFor(() => room.state.phase === "lobby", 20_000, "back to lobby");
  });
});
