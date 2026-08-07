import { describe, expect, it } from "vitest";

import { KART_RACING_SERVER_CONSTANTS } from "../../../src/games/kart-racing/constants.js";
import {
  endRaceIfAllDisconnected,
  fireProjectile,
  updateRacePositions,
  updateRuntime,
} from "../../../src/games/kart-racing/engine.js";
import { prepareRace } from "../../../src/games/kart-racing/runtime.js";
import { createTestRuntime, runAutopilot } from "./helpers.js";

const START_NOW = 1_000;

function advance(runtime: ReturnType<typeof createTestRuntime>, from: number, to: number): void {
  let now = from;
  while (now < to) {
    now = Math.min(to, now + 50);
    updateRuntime(runtime, now);
  }
}

describe("Kart Racing engine", () => {
  it("locks karts during the countdown and only moves them after GO", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    if (!alice) {
      throw new Error("missing player");
    }
    expect(runtime.phase).toBe("countdown");
    const startX = alice.x;
    const startY = alice.y;
    alice.targetSteering = 1;
    updateRuntime(runtime, START_NOW + 50);
    expect(alice.x).toBe(startX);
    expect(alice.y).toBe(startY);

    updateRuntime(runtime, START_NOW + runtime.settings.countdownMs);
    expect(runtime.phase).toBe("racing");
    expect(alice.x).toBe(startX);
    expect(alice.y).toBe(startY);

    updateRuntime(runtime, START_NOW + runtime.settings.countdownMs + 100);
    expect(alice.x).not.toBe(startX);
  });

  it("drives a full three-race match with two karts through authoritative simulation", () => {
    const runtime = createTestRuntime(2);
    const finishedAt = runAutopilot(runtime, START_NOW, 300_000);
    expect(runtime.phase).toBe("finished");
    expect(finishedAt).toBeLessThan(START_NOW + 300_000);
    expect(runtime.raceNumber).toBe(3);
    expect(runtime.result).not.toBeNull();
    expect(runtime.result?.leaderboard).toHaveLength(2);
    const points = [...runtime.players.values()].map((player) => player.matchPoints);
    expect(points.sort((a, b) => b - a)).toEqual([24, 18]);
    // A race may legitimately end by the race-finish timeout (the task's
    // rule for stuck/disconnected players), so the assertion is about a
    // complete match with correct points rather than every player finishing
    // every lap.
    expect(runtime.players.get("session-0")?.matchPoints).toBe(24);
    expect(runtime.players.get("session-1")?.matchPoints).toBe(18);
  });

  it("gives every player independent access to the same crate and caps ammo at one", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing player");
    }
    const crate = runtime.activeCrates[0];
    if (!crate) {
      throw new Error("missing crate");
    }
    // Both start the race and drive onto the same crate.
    runtime.countdownEndsAt = START_NOW;
    alice.x = crate.x + 10;
    alice.y = crate.y;
    bob.x = crate.x - 10;
    bob.y = crate.y;
    advance(runtime, START_NOW, START_NOW + 200);

    expect(alice.ammoLoaded).toBe(true);
    expect(bob.ammoLoaded).toBe(true);
    expect(alice.collectedCrateIds.has(crate.id)).toBe(true);
    expect(bob.collectedCrateIds.has(crate.id)).toBe(true);

    // Loaded karts cannot collect a second crate.
    const secondCrate = runtime.activeCrates[1];
    if (!secondCrate) {
      throw new Error("missing second crate");
    }
    alice.x = secondCrate.x;
    alice.y = secondCrate.y;
    advance(runtime, START_NOW + 200, START_NOW + 400);
    expect(alice.ammoLoaded).toBe(true);
    expect(alice.collectedCrateIds.has(secondCrate.id)).toBe(false);
  });

  it("stops a kart with a projectile and immunity prevents stacking", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing player");
    }
    runtime.countdownEndsAt = START_NOW;
    alice.x = 500;
    alice.y = 1050;
    alice.heading = 0;
    bob.x = 560;
    bob.y = 1050;
    bob.heading = Math.PI;
    advance(runtime, START_NOW, START_NOW + 100);
    alice.ammoLoaded = true;
    fireProjectile(runtime, alice);
    expect(alice.ammoLoaded).toBe(false);
    advance(runtime, START_NOW + 100, START_NOW + 200);
    expect(bob.hitStopUntil).toBeGreaterThan(START_NOW + 200);
    const firstStop = bob.hitStopUntil;

    // A second projectile during hit-stop is consumed without stacking.
    alice.ammoLoaded = true;
    alice.x = bob.x - 100;
    alice.y = bob.y;
    fireProjectile(runtime, alice);
    advance(runtime, START_NOW + 200, START_NOW + 300);
    expect(bob.hitStopUntil).toBe(firstStop);
    expect(runtime.projectiles).toHaveLength(0);
  });

  it("falls off the track, respawns at the last checkpoint, and is immune after respawn", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    if (!alice) {
      throw new Error("missing player");
    }
    runtime.countdownEndsAt = START_NOW;
    alice.x = 800;
    alice.y = 600; // infield fall zone
    alice.heading = Math.PI;
    advance(runtime, START_NOW, START_NOW + 100);
    expect(alice.active).toBe(false);
    expect(alice.respawnUntil).toBeGreaterThan(START_NOW + 100);
    const respawnPoint = alice.respawnPoint;
    expect(respawnPoint).not.toBeNull();

    advance(
      runtime,
      START_NOW + 100,
      START_NOW + 100 + KART_RACING_SERVER_CONSTANTS.RESPAWN_DELAY_MS,
    );
    expect(alice.active).toBe(true);
    expect(alice.respawnImmunityUntil).toBeGreaterThan(START_NOW + 1_100);
    expect(
      Math.hypot(alice.x - (respawnPoint?.x ?? 0), alice.y - (respawnPoint?.y ?? 0)),
    ).toBeLessThan(5);
  });

  it("ranks unfinished players behind finishers when the race-finish timeout ends", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing player");
    }
    runtime.countdownEndsAt = START_NOW;
    // Alice crosses the finish line immediately; Bob is disconnected and stuck.
    alice.x = 245;
    alice.y = 1050;
    alice.prevX = 245;
    alice.prevY = 1050;
    alice.completedLaps = 2;
    alice.nextCheckpointIndex = 5;
    alice.speed = 510;
    alice.heading = 0;
    bob.connected = false;
    bob.active = false;
    advance(runtime, START_NOW, START_NOW + 100);
    expect(runtime.raceFinishOrder).toEqual(["session-0"]);
    expect(runtime.raceFinishTimeoutEndsAt).toBeGreaterThan(0);

    advance(runtime, START_NOW + 100, START_NOW + 100 + runtime.settings.raceFinishTimeoutMs + 1);
    expect(runtime.phase).toBe("race-result");
    const entries = runtime.raceResult ?? [];
    expect(entries.map((entry) => entry.sessionId)).toEqual(["session-0", "session-1"]);
    expect(entries[0]?.points).toBe(8);
    expect(entries[1]?.points).toBe(6);
    expect(entries[1]?.timedOut).toBe(true);
    expect(alice.matchPoints).toBe(8);
    expect(bob.matchPoints).toBe(6);
  });

  it("ends the race by timeout even when another kart is connected but stuck", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing player");
    }
    runtime.countdownEndsAt = START_NOW;
    alice.x = 245;
    alice.y = 1050;
    alice.prevX = 245;
    alice.prevY = 1050;
    alice.completedLaps = 2;
    alice.nextCheckpointIndex = 5;
    alice.speed = 510;
    alice.heading = 0;
    // Bob is connected but parked on the road; the timeout must still end the
    // race and rank him behind the finisher.
    bob.x = 1510;
    bob.y = 800;
    bob.heading = -Math.PI / 2;
    bob.targetSteering = 0;
    advance(runtime, START_NOW, START_NOW + 100);
    expect(runtime.raceFinishOrder).toEqual(["session-0"]);
    advance(runtime, START_NOW + 100, START_NOW + 100 + runtime.settings.raceFinishTimeoutMs + 1);
    expect(runtime.phase).toBe("race-result");
    const entries = runtime.raceResult ?? [];
    expect(entries.map((entry) => entry.sessionId)).toEqual(["session-0", "session-1"]);
    expect(entries[1]?.timedOut).toBe(true);
  });

  it("updates live race positions by completed laps, checkpoints, and progress", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing player");
    }
    alice.completedLaps = 1;
    alice.nextCheckpointIndex = 2;
    bob.completedLaps = 1;
    bob.nextCheckpointIndex = 1;
    updateRacePositions(runtime);
    expect(alice.racePosition).toBe(1);
    expect(bob.racePosition).toBe(2);
  });

  it("starts race two with the last finisher first, timed-out players behind them, and the winner last", () => {
    const runtime = createTestRuntime(3);
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    const carol = runtime.players.get("session-2");
    if (!alice || !bob || !carol) {
      throw new Error("missing player");
    }
    alice.finishPosition = 1;
    alice.completedLaps = 3;
    bob.finishPosition = 2;
    bob.completedLaps = 3;
    carol.finishPosition = 0; // timed out on the previous race
    carol.completedLaps = 0;
    carol.nextCheckpointIndex = 0;

    prepareRace(runtime, 10_000, 2);
    expect(runtime.startingGrid).toEqual(["session-1", "session-2", "session-0"]);
  });

  it("uses strict reverse finishing order when everyone finished the previous race", () => {
    const runtime = createTestRuntime(3);
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    const carol = runtime.players.get("session-2");
    if (!alice || !bob || !carol) {
      throw new Error("missing player");
    }
    alice.finishPosition = 1;
    bob.finishPosition = 2;
    carol.finishPosition = 3;

    prepareRace(runtime, 10_000, 2);
    expect(runtime.startingGrid).toEqual(["session-2", "session-1", "session-0"]);
  });

  it("stops karts at outer walls and reduces their speed", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    if (!alice) {
      throw new Error("missing player");
    }
    runtime.countdownEndsAt = START_NOW;
    alice.x = 1550;
    alice.y = 800;
    alice.heading = 0;
    alice.speed = 300;
    alice.targetSteering = 0;
    advance(runtime, START_NOW, START_NOW + 300);
    expect(alice.x).toBeLessThanOrEqual(1600);
    expect(alice.speed).toBeLessThan(300);
  });

  it("pushes karts out of static obstacles and slows them", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    if (!alice) {
      throw new Error("missing player");
    }
    runtime.countdownEndsAt = START_NOW;
    alice.x = 1520;
    alice.y = 800;
    alice.heading = Math.PI;
    alice.speed = 300;
    alice.targetSteering = 0;
    advance(runtime, START_NOW, START_NOW + 300);
    expect(alice.x).toBeGreaterThanOrEqual(1520);
    expect(alice.speed).toBeLessThan(300);
  });

  it("shows the wrong-way warning after driving against the track direction", () => {
    const runtime = createTestRuntime(2);
    const alice = runtime.players.get("session-0");
    if (!alice) {
      throw new Error("missing player");
    }
    runtime.countdownEndsAt = START_NOW;
    alice.x = 1200;
    alice.y = 1050;
    alice.heading = Math.PI;
    alice.speed = 510;
    alice.targetSteering = 0;
    advance(runtime, START_NOW, START_NOW + 2_000);
    expect(alice.wrongWay).toBe(true);
  });

  it("ends the race immediately when every remaining player disconnects", () => {
    const runtime = createTestRuntime(2);
    runtime.countdownEndsAt = START_NOW;
    const alice = runtime.players.get("session-0");
    const bob = runtime.players.get("session-1");
    if (!alice || !bob) {
      throw new Error("missing player");
    }
    advance(runtime, START_NOW, START_NOW + 100);
    alice.connected = false;
    alice.active = false;
    bob.connected = false;
    bob.active = false;
    endRaceIfAllDisconnected(runtime, START_NOW + 100);
    expect(runtime.phase).toBe("race-result");
    expect(runtime.raceResult).toHaveLength(2);
  });
});
