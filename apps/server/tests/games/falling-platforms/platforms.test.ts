import { describe, expect, it } from "vitest";
import {
  addPlayer,
  startMatch,
  startPlaying,
} from "../../../src/games/falling-platforms/engine.js";
import {
  difficultyStepFor,
  selectAndWarnPlatforms,
  selectBatch,
  transitionWarningsToGone,
} from "../../../src/games/falling-platforms/platforms.js";
import { addPlayerAt, makeRuntime, platform } from "./helpers.js";

describe("platform lifecycle", () => {
  it("moves a stable platform to warning", () => {
    const runtime = makeRuntime({ e2eMode: true });
    const target = platform(runtime, "3:4");
    runtime.nextWarningAt = 1_000;
    selectAndWarnPlatforms(runtime, 1_000);
    expect(target.state).toBe("warning");
    expect(target.goneAt).toBe(1_000 + runtime.settings.platformWarningMs);
  });

  it("moves a warning platform to gone at its deadline", () => {
    const runtime = makeRuntime({ e2eMode: true });
    const target = platform(runtime, "3:4");
    runtime.nextWarningAt = 1_000;
    selectAndWarnPlatforms(runtime, 1_000);
    const gone = transitionWarningsToGone(runtime, target.goneAt);
    expect(gone).toContain("3:4");
    expect(target.state).toBe("gone");
  });

  it("does not transition a warning platform before its deadline", () => {
    const runtime = makeRuntime({ e2eMode: true });
    runtime.nextWarningAt = 1_000;
    selectAndWarnPlatforms(runtime, 1_000);
    const target = platform(runtime, "3:4");
    expect(transitionWarningsToGone(runtime, target.goneAt - 1)).toEqual([]);
    expect(target.state).toBe("warning");
  });

  it("never selects the same platform twice in a batch", () => {
    const runtime = makeRuntime();
    for (let i = 0; i < 5; i++) {
      const batch = selectBatch(runtime, [...runtime.platforms.keys()], 3);
      expect(new Set(batch).size).toBe(batch.length);
    }
  });

  it("is reproducible for a fixed seed", () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const a = selectBatch(first, [...first.platforms.keys()], 4);
    const b = selectBatch(second, [...second.platforms.keys()], 4);
    expect(a).toEqual(b);
  });

  it("leaves at least one grounded survivor platform unselected in a batch", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    addPlayerAt(runtime, "p2", "P2", "3:4");
    for (let i = 0; i < 20; i++) {
      const batch = selectBatch(runtime, [...runtime.platforms.keys()], 2);
      const selectedSurvivorPlatforms = ["3:3", "3:4"].filter((id) => batch.includes(id));
      expect(selectedSurvivorPlatforms.length).toBeLessThanOrEqual(1);
    }
  });

  it("allows selecting occupied platforms with a single survivor", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    expect(selectBatch(runtime, ["3:3"], 1)).toEqual(["3:3"]);
  });

  it("does not re-select warning platforms", () => {
    const runtime = makeRuntime();
    const target = platform(runtime, "3:4");
    target.state = "warning";
    target.goneAt = 2_000;
    const batch = selectBatch(runtime, [...runtime.platforms.keys()], 3);
    expect(batch).not.toContain("3:4");
  });
});

describe("difficulty schedule", () => {
  it("returns a valid step for any elapsed time", () => {
    const runtime = makeRuntime();
    runtime.matchStartedAt = 0;
    for (const elapsed of [0, 5_000, 20_000, 35_000, 50_000, 120_000]) {
      const step = difficultyStepFor(runtime, elapsed);
      expect(step.batchSize).toBeGreaterThan(0);
      expect(step.intervalMs).toBeGreaterThan(0);
    }
  });
});

describe("seeded spawning", () => {
  it("produces unique deterministic spawns for a fixed seed", () => {
    const runtime = makeRuntime({ e2eMode: true });
    runtime.phase = "lobby";
    runtime.players.clear();
    addPlayer(runtime, "p1", "P1", 0);
    addPlayer(runtime, "p2", "P2", 1);
    addPlayer(runtime, "p3", "P3", 2);
    expect(startMatch(runtime, 0)).toBe(true);
    const spawns = [...runtime.players.values()].map((player) => player.currentPlatformId);
    expect(new Set(spawns).size).toBe(spawns.length);
    expect(runtime.arenaSide).toBe(7);

    const runtime2 = makeRuntime({ e2eMode: true });
    runtime2.phase = "lobby";
    runtime2.players.clear();
    addPlayer(runtime2, "p1", "P1", 0);
    addPlayer(runtime2, "p2", "P2", 1);
    addPlayer(runtime2, "p3", "P3", 2);
    expect(startMatch(runtime2, 0)).toBe(true);
    const spawns2 = [...runtime2.players.values()].map((player) => player.currentPlatformId);
    expect(spawns2).toEqual(spawns);
  });

  it("reproduces the E2E spawns and first warning target", () => {
    const runtime = makeRuntime({ e2eMode: true });
    runtime.phase = "lobby";
    runtime.players.clear();
    addPlayer(runtime, "p1", "P1", 0);
    addPlayer(runtime, "p2", "P2", 1);
    expect(startMatch(runtime, 0)).toBe(true);
    expect(runtime.arenaSide).toBe(7);
    const spawns = [...runtime.players.values()].map((player) => player.currentPlatformId);
    expect(spawns).toEqual(["3:3", "3:4"]);

    startPlaying(runtime, 1_200);
    expect(runtime.nextWarningAt).toBe(2_400);
    selectAndWarnPlatforms(runtime, 2_400);
    expect(platform(runtime, "3:4").state).toBe("warning");
  });
});
