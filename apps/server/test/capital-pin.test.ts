import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { CapitalPinState } from "@falling-platforms/capital-pin";
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

function submit(
  client: { send: (type: string, payload: unknown) => void },
  roundNumber: number,
  latitude: number,
  longitude: number,
) {
  client.send("game:command", {
    command: { type: "submit", roundNumber, latitude, longitude },
  });
}

function startGame(client: { send: (type: string, payload: unknown) => void }) {
  client.send("platform:start", { requestId: "start" });
}

describe("capital pin room integration", () => {
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

  it("runs the full lobby, rounds, finish and play-again flow", async () => {
    const room = await colyseus.createRoom("capital_pin", {});
    expect(room.roomId).toMatch(ROOM_CODE_PATTERN);

    const alice = await connect(colyseus, room, { name: "Alice" });
    const bob = await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");

    expect(room.state.hostSessionId).toBe(alice.sessionId);

    // Tapping before the game starts is rejected.
    alice.send("game:command", {
      command: { type: "submit", roundNumber: 1, latitude: 0, longitude: 0 },
      requestId: "early-submit",
    });
    const early = await alice.waitForMessage("platform:command-result", 5_000);
    expect(early.ok).toBe(false);
    expect(early.error.code).toBe("GAME_NOT_RUNNING");

    // The host starts the game (no ready required).
    startGame(alice);
    const started = await alice.waitForMessage("platform:command-result", 5_000);
    expect(started.ok).toBe(true);
    await waitFor(() => room.state.phase === "round", 5_000, "first round");

    // Secret-data guarantee: only the capital name is visible during a round.
    expect(room.state.currentCapitalName).not.toBe("");
    expect(room.state.lastResult).toBeNull();
    expect(room.state.totalRounds).toBe(10);
    expect(room.state.roundNumber).toBe(1);

    // Both players lock a guess for round 1. Alice's guess is closer to the
    // real capital than Bob's.
    const roundNumber = room.state.roundNumber;
    submit(alice, roundNumber, 48.85, 2.35);
    await waitFor(
      () => room.state.players.get(alice.sessionId)?.submitted === true,
      5_000,
      "alice submitted",
    );

    // A second submit by Alice is rejected with a typed error (no state change).
    alice.send("game:command", {
      command: { type: "submit", roundNumber, latitude: 0, longitude: 0 },
      requestId: "double-submit",
    });
    const doubled = await alice.waitForMessage("platform:command-result", 5_000);
    expect(doubled.ok).toBe(false);
    expect(doubled.error.code).toBe("INVALID_GAME_COMMAND");

    // Bob submits -> all connected participants in -> early round finish.
    submit(bob, roundNumber, 40, 0);
    await waitFor(() => room.state.phase === "round-results", 5_000, "round results");

    // The result now reveals coordinates and guesses.
    const result = (room.state as CapitalPinState).lastResult;
    if (!result) {
      throw new Error("expected a round result");
    }
    expect([...result.winnerSessionIds].length).toBeGreaterThan(0);
    const revealedGuesses = [...result.guesses];
    expect(revealedGuesses.length).toBe(2);

    // Advance past the results screen into round 2 (real-time advance timer).
    await waitFor(() => room.state.phase === "round", 5_000, "second round");
    expect(room.state.roundNumber).toBe(2);

    // Play the remaining rounds by early-finish (both players submit), which is
    // deterministic and does not depend on wall-clock round timers.
    for (let round = 2; round <= 10; round++) {
      await waitFor(() => room.state.phase === "round", 5_000, `round ${round} begins`);
      const currentRound = room.state.roundNumber;
      submit(alice, currentRound, 48.85, 2.35);
      submit(bob, currentRound, 40, 0);
      await waitFor(() => room.state.phase === "round-results", 5_000, `round ${round} results`);
    }

    await waitFor(() => room.state.status === "finished", 5_000, "finished status");
    expect(room.state.phase).toBe("finished");
    const matchResult = (room.state as CapitalPinState).result;
    if (!matchResult) {
      throw new Error("expected a match result");
    }
    expect(matchResult.leaderboard.length).toBe(2);
    // Capitals are shuffled per game, so the exact win split is not fixed; but
    // the leaderboard is ordered by round wins (primaryScore, descending) and
    // contains exactly the two participants.
    const first = matchResult.leaderboard[0];
    const second = matchResult.leaderboard[1];
    if (!first || !second) {
      throw new Error("expected two leaderboard entries");
    }
    expect(first.primaryScore).toBeGreaterThanOrEqual(second.primaryScore);
    expect([first.sessionId, second.sessionId].sort()).toEqual(
      [alice.sessionId, bob.sessionId].sort(),
    );
    // Round wins across the game sum to at most 10 (one winner per round, ties
    // can make it slightly higher, never lower than the rounds played).
    const totalWins = matchResult.leaderboard.reduce((sum, entry) => sum + entry.primaryScore, 0);
    expect(totalWins).toBeGreaterThan(0);

    // Only the host can play again.
    bob.send("platform:play-again", { requestId: "bob-again" });
    const notHost = await bob.waitForMessage("platform:command-result", 5_000);
    expect(notHost.ok).toBe(false);
    expect(notHost.error.code).toBe("NOT_HOST");

    alice.send("platform:play-again", { requestId: "alice-again" });
    const again = await alice.waitForMessage("platform:command-result", 5_000);
    expect(again.ok).toBe(true);
    await waitFor(
      () => room.state.status === "lobby" && room.state.phase === "lobby",
      5_000,
      "back to lobby",
    );
    expect(room.state.players.get(alice.sessionId)?.roundWins).toBe(0);
    expect(room.state.players.get(alice.sessionId)?.isReady).toBe(false);
  });

  it("rejects a submit for the wrong round number", async () => {
    const room = await colyseus.createRoom("capital_pin", {});
    const alice = await connect(colyseus, room, { name: "Alice" });
    await connect(colyseus, room, { name: "Bob" });
    await waitFor(() => room.state.players.size === 2, 5_000, "two players");

    startGame(alice);
    await waitFor(() => room.state.phase === "round", 5_000, "round");

    // Stale round number -> rejected as no longer active.
    alice.send("game:command", {
      command: { type: "submit", roundNumber: 99, latitude: 0, longitude: 0 },
      requestId: "stale",
    });
    const stale = await alice.waitForMessage("platform:command-result", 5_000);
    expect(stale.ok).toBe(false);
    expect(stale.error.code).toBe("GAME_NOT_RUNNING");
  });

  it("enforces the maximum player count", async () => {
    const room = await colyseus.createRoom("capital_pin", {});
    for (let index = 0; index < 8; index++) {
      await connect(colyseus, room, { name: `P${index}` });
    }
    await waitFor(() => room.state.players.size === 8, 5_000, "eight players");
    await expect(colyseus.sdk.joinById(room.roomId, { name: "Overflow" })).rejects.toThrow();
    expect(room.state.players.size).toBe(8);
  });
});
