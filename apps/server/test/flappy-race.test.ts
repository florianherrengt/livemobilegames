import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { FlappyRaceState } from "@falling-platforms/flappy-race";
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

function startGame(client: { send: (type: string, payload: unknown) => void }, id: string) {
  client.send("platform:start", { requestId: `${id}-start` });
}

function flap(
  client: { send: (type: string, payload: unknown) => void },
  sequence: number,
  roundNumber: number,
  requestId?: string,
) {
  client.send("game:command", {
    command: { type: "flap", sequence, roundNumber },
    ...(requestId ? { requestId } : {}),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("flappy race room integration", () => {
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

  it("runs the full five-round match with draws, a furthest-player win and a final scoreboard", async () => {
    const room = await colyseus.createRoom("flappy_race", {});
    expect(room.roomId).toMatch(ROOM_CODE_PATTERN);

    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    expect(room.state.hostSessionId).toBe(alice.sessionId);

    // Bob cannot start; Alice can.
    startGame(bob, "bob");
    const notHost = await bob.waitForMessage("platform:command-result", 5_000);
    expect(notHost.ok).toBe(false);
    expect(notHost.error.code).toBe("NOT_HOST");
    startGame(alice, "alice");
    const started = await alice.waitForMessage("platform:command-result", 5_000);
    expect(started.ok).toBe(true);

    await waitFor(() => room.state.phase === "countdown", 5_000, "countdown phase");
    const state = room.state as FlappyRaceState;
    expect(state.countdownEndsAt).toBeGreaterThan(Date.now());
    expect(state.courseElapsedMs).toBe(0);
    expect(state.courseSpeed).toBe(450);
    expect(state.obstacleOpenings.length).toBeGreaterThan(0);
    expect(state.courseSeed).toBe("flappy-race-e2e-deterministic");
    expect(state.totalRounds).toBe(5);
    expect(state.players.get(alice.sessionId)?.color).not.toBe("");
    expect(state.players.get(bob.sessionId)?.color).not.toBe("");
    expect(state.players.get(alice.sessionId)?.color).not.toBe(
      state.players.get(bob.sessionId)?.color,
    );
    expect(state.players.get(alice.sessionId)?.birdY).toBe(state.players.get(bob.sessionId)?.birdY);

    // Flaps during the countdown move only the flapping bird; obstacles stay put.
    flap(alice, 1, 1, "alice-flap-1");
    const accepted = await alice.waitForMessage("platform:command-result", 5_000);
    expect(accepted.ok).toBe(true);
    await waitFor(
      () => {
        const aliceY = room.state.players.get(alice.sessionId)?.birdY ?? 0;
        const bobY = room.state.players.get(bob.sessionId)?.birdY ?? 0;
        return aliceY < bobY;
      },
      5_000,
      "alice rises above bob",
    );
    expect((room.state as FlappyRaceState).courseElapsedMs).toBe(0);

    // Countdown timer advances the course on the server clock.
    room.clock.tick(room.clock.currentTime + 800);
    await waitFor(() => room.state.phase === "running", 5_000, "running phase");
    await waitFor(
      () => (room.state as FlappyRaceState).courseElapsedMs > 0,
      5_000,
      "course elapsed advances",
    );

    // Round 1: nobody flaps, both crash into obstacle 2 -> draw, one win each.
    await waitFor(() => room.state.phase === "round-result", 20_000, "round 1 result");
    let roundWinners = [...(room.state as FlappyRaceState).roundWinnerSessionIds];
    expect(roundWinners.sort()).toEqual([alice.sessionId, bob.sessionId].sort());
    expect(room.state.players.get(alice.sessionId)?.roundWins).toBe(1);
    expect(room.state.players.get(bob.sessionId)?.roundWins).toBe(1);
    expect(room.state.players.get(alice.sessionId)?.clearedObstacleCount).toBe(1);
    expect(room.state.players.get(bob.sessionId)?.clearedObstacleCount).toBe(1);

    // Round 2: Alice flaps up and crashes at obstacle 1; Bob passes it and wins.
    await waitFor(
      () => room.state.phase === "countdown" && room.state.roundNumber === 2,
      5_000,
      "round 2 countdown",
    );
    for (let index = 0; index < 12; index++) {
      flap(alice, 100 + index, 2);
      await sleep(90);
    }
    await waitFor(() => room.state.phase === "round-result", 10_000, "round 2 result");
    roundWinners = [...(room.state as FlappyRaceState).roundWinnerSessionIds];
    expect(roundWinners).toEqual([bob.sessionId]);
    expect(room.state.players.get(alice.sessionId)?.roundWins).toBe(1);
    expect(room.state.players.get(bob.sessionId)?.roundWins).toBe(2);
    expect(room.state.players.get(alice.sessionId)?.clearedObstacleCount).toBe(0);
    expect(room.state.players.get(bob.sessionId)?.clearedObstacleCount).toBe(1);

    // Rounds 3-4 draw with no input; round 5 goes straight to the final board.
    for (let round = 3; round <= 4; round++) {
      await waitFor(
        () => room.state.phase === "round-result" && room.state.roundNumber === round,
        20_000,
        `round ${round} result`,
      );
      const winners = [...(room.state as FlappyRaceState).roundWinnerSessionIds];
      expect(winners.sort()).toEqual([alice.sessionId, bob.sessionId].sort());
    }
    await waitFor(
      () => room.state.phase === "countdown" && room.state.roundNumber === 5,
      10_000,
      "round 5 countdown",
    );

    await waitFor(
      () => room.state.status === "finished" && room.state.phase === "finished",
      10_000,
      "finished status",
    );
    expect((room.state as FlappyRaceState).roundNumber).toBe(5);
    const result = (room.state as FlappyRaceState).result;
    if (!result) {
      throw new Error("expected a match result");
    }
    expect([...result.winnerSessionIds]).toEqual([bob.sessionId]);
    const leaderboard = [...result.leaderboard];
    const aliceEntry = leaderboard.find((entry) => entry.sessionId === alice.sessionId);
    const bobEntry = leaderboard.find((entry) => entry.sessionId === bob.sessionId);
    expect(aliceEntry?.primaryScore).toBe(4);
    expect(bobEntry?.primaryScore).toBe(5);
    expect(aliceEntry?.rank).toBe(2);
    expect(bobEntry?.rank).toBe(1);

    // Host play-again returns to the lobby and resets scores.
    bob.send("platform:play-again", { requestId: "bob-again" });
    const notHostAgain = await bob.waitForMessage("platform:command-result", 5_000);
    expect(notHostAgain.ok).toBe(false);
    alice.send("platform:play-again", { requestId: "alice-again" });
    const again = await alice.waitForMessage("platform:command-result", 5_000);
    expect(again.ok).toBe(true);
    await waitFor(
      () => room.state.status === "lobby" && room.state.phase === "lobby",
      5_000,
      "back to lobby",
    );
    expect(room.state.players.get(alice.sessionId)?.roundWins).toBe(0);
  });

  it("rejects invalid, stale and spectator flaps and never trusts client positions", async () => {
    const room = await colyseus.createRoom("flappy_race", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");

    // Flap before the match starts is rejected by the platform.
    flap(alice, 1, 1, "early");
    const early = await alice.waitForMessage("platform:command-result", 5_000);
    expect(early.ok).toBe(false);
    expect(early.error.code).toBe("GAME_NOT_RUNNING");

    startGame(alice, "alice");
    await alice.waitForMessage("platform:command-result", 5_000);
    await waitFor(() => room.state.phase === "running", 10_000, "running");

    // Unknown command type.
    alice.send("game:command", { command: { type: "jump" }, requestId: "unknown" });
    const unknown = await alice.waitForMessage("platform:command-result", 5_000);
    expect(unknown.ok).toBe(false);
    expect(unknown.error.code).toBe("INVALID_GAME_COMMAND");

    // Clients cannot submit positions, velocities or scores.
    alice.send("game:command", {
      command: { type: "flap", sequence: 2, roundNumber: 1, birdY: 999, vy: -999 },
      requestId: "cheat-position",
    });
    const cheat = await alice.waitForMessage("platform:command-result", 5_000);
    expect(cheat.ok).toBe(false);
    expect(cheat.error.code).toBe("INVALID_GAME_COMMAND");

    // Flap for an old round.
    flap(alice, 3, 99, "old-round");
    const oldRound = await alice.waitForMessage("platform:command-result", 5_000);
    expect(oldRound.ok).toBe(false);
    expect(oldRound.error.code).toBe("INVALID_GAME_COMMAND");

    // Valid flap accepted; duplicate sequence is deduplicated.
    flap(alice, 4, 1, "ok-flap");
    const ok = await alice.waitForMessage("platform:command-result", 5_000);
    expect(ok.ok).toBe(true);
    flap(alice, 4, 1, "dupe-flap");
    const dupe = await alice.waitForMessage("platform:command-result", 5_000);
    expect(dupe.ok).toBe(true);
    expect(dupe.data.reason).toBe("duplicate");

    // Round 1 ends (both crash); a spectator flap during round-result is rejected.
    await waitFor(() => room.state.phase === "round-result", 20_000, "round 1 result");
    flap(alice, 5, 1, "spectator-flap");
    const spectator = await alice.waitForMessage("platform:command-result", 5_000);
    expect(spectator.ok).toBe(false);
    expect(spectator.error.code).toBe("GAME_NOT_RUNNING");
  });

  it("removes disconnected players from the round and lets reconnects spectate", async () => {
    const room = await colyseus.createRoom("flappy_race", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    const bobSessionId = bob.sessionId;
    const bobToken = bob.reconnectionToken;

    startGame(alice, "alice");
    await alice.waitForMessage("platform:command-result", 5_000);
    await waitFor(() => room.state.phase === "countdown", 5_000, "countdown");

    // Bob drops mid-round: Alice becomes the sole eligible player and wins.
    bob.connection.close();
    await waitFor(
      () => room.state.players.get(bobSessionId)?.connectionStatus === "reconnecting",
      5_000,
      "bob reconnecting",
    );
    await waitFor(() => room.state.phase === "round-result", 10_000, "round resolved");
    expect([...(room.state as FlappyRaceState).roundWinnerSessionIds]).toEqual([alice.sessionId]);
    expect(room.state.players.get(bobSessionId)?.roundActive).toBe(false);

    // Bob reconnects with the same identity but spectates the rest of the match.
    const reconnected = await colyseus.sdk.reconnect(bobToken);
    expect(reconnected.sessionId).toBe(bobSessionId);
    await waitFor(
      () => room.state.players.get(bobSessionId)?.connectionStatus === "connected",
      5_000,
      "bob connected again",
    );

    await waitFor(
      () => room.state.phase === "countdown" && room.state.roundNumber === 2,
      10_000,
      "round 2 countdown",
    );
    expect(room.state.players.get(bobSessionId)?.roundActive).toBe(false);
    expect(room.state.players.get(bobSessionId)?.matchRemoved).toBe(true);
    expect(room.state.players.get(alice.sessionId)?.roundActive).toBe(true);

    // Alice wins every remaining round; Bob keeps earlier score and spectates.
    await waitFor(
      () => room.state.status === "finished" && room.state.phase === "finished",
      40_000,
      "match finished",
    );
    const result = (room.state as FlappyRaceState).result;
    if (!result) {
      throw new Error("expected a match result");
    }
    expect([...result.winnerSessionIds]).toEqual([alice.sessionId]);
    expect([...result.leaderboard].length).toBe(2);
    const aliceEntry = [...result.leaderboard].find((entry) => entry.sessionId === alice.sessionId);
    expect(aliceEntry?.primaryScore).toBe(5);

    // A second disconnect after grace removes Bob from the room entirely.
    reconnected.connection.close();
    await waitFor(() => room.state.players.size === 1, 10_000, "bob removed after grace");
  });

  it("returns to the lobby when every player disconnects mid-match", async () => {
    const room = await colyseus.createRoom("flappy_race", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");
    startGame(alice, "alice");
    await alice.waitForMessage("platform:command-result", 5_000);
    await waitFor(() => room.state.phase === "countdown", 5_000, "countdown");

    alice.connection.close();
    bob.connection.close();
    // Either the shared lifecycle resets the room to the lobby, or the grace
    // period removes everyone and the room is disposed. Both are safe ends.
    await waitFor(
      () =>
        (room.state.status === "lobby" && room.state.phase === "lobby") ||
        room.state.players.size === 0,
      15_000,
      "room reset or disposed",
    );
    if (room.state.status === "lobby") {
      expect((room.state as FlappyRaceState).roundNumber).toBe(0);
    }
  });
});
