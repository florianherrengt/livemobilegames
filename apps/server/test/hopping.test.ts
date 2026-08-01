import { describe, expect, it } from "vitest";

import { isJumpActive, resolveLanding, startHop, validateHop } from "../src/game/hopping.js";
import { eliminatePlayersOnPlatform, updateMatch } from "../src/game/match.js";
import { addPlayerAt, makeRuntime, platform, player } from "./helpers.js";

describe("hop validation", () => {
  it("rejects hops when the match is not playing", () => {
    const runtime = makeRuntime();
    runtime.phase = "countdown";
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    expect(validateHop(runtime, player, "3:4", 1)).toBe("not-playing");
  });

  it("rejects hops from dead or non-participating players", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    player.alive = false;
    expect(validateHop(runtime, player, "3:4", 1)).toBe("not-alive");
  });

  it("accepts orthogonal and diagonal targets", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    expect(validateHop(runtime, player, "3:4", 1)).toBeNull();
    expect(validateHop(runtime, player, "4:4", 2)).toBeNull();
  });

  it("rejects the current platform as a target", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    expect(validateHop(runtime, player, "3:3", 1)).toBe("not-adjacent");
  });

  it("rejects malformed platform ids", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    expect(validateHop(runtime, player, "banana", 1)).toBe("invalid-target");
    expect(validateHop(runtime, player, "999", 1)).toBe("invalid-target");
  });

  it("rejects unknown platforms", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    expect(validateHop(runtime, player, "99:99", 1)).toBe("invalid-target");
  });

  it("rejects gone targets", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    const target = platform(runtime, "3:4");
    target.state = "gone";
    expect(validateHop(runtime, player, "3:4", 1)).toBe("target-gone");
  });

  it("accepts warning targets", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    const target = platform(runtime, "3:4");
    target.state = "warning";
    expect(validateHop(runtime, player, "3:4", 1)).toBeNull();
  });

  it("rejects a target two spaces away", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    expect(validateHop(runtime, player, "3:5", 1)).toBe("not-adjacent");
  });

  it("rejects stale sequences", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, player, "3:4", 5, 0);
    resolveLanding(runtime, player);
    expect(validateHop(runtime, player, "3:4", 4)).toBe("stale-sequence");
  });

  it("rejects duplicate sequences", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, player, "3:4", 5, 0);
    resolveLanding(runtime, player);
    expect(validateHop(runtime, player, "3:4", 5)).toBe("stale-sequence");
  });

  it("rejects hops while airborne", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, player, "3:4", 1, 0);
    expect(validateHop(runtime, player, "4:4", 2)).toBe("already-jumping");
  });
});

describe("jump lifecycle", () => {
  it("starts a valid hop", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, player, "3:4", 1, 100);
    expect(player.jumping).toBe(true);
    expect(player.fromPlatformId).toBe("3:3");
    expect(player.targetPlatformId).toBe("3:4");
    expect(player.jumpStartedAt).toBe(100);
    expect(player.jumpEndsAt).toBe(100 + runtime.settings.hopDurationMs);
    expect(player.lastAcceptedSequence).toBe(1);
  });

  it("keeps a jump active before its deadline", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, player, "3:4", 1, 100);
    expect(isJumpActive(player, 100 + runtime.settings.hopDurationMs - 1)).toBe(true);
  });

  it("completes a jump at its deadline", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, player, "3:4", 1, 100);
    expect(resolveLanding(runtime, player)).toBe("landed");
    expect(player.jumping).toBe(false);
    expect(player.currentPlatformId).toBe("3:4");
    expect(player.fromPlatformId).toBe("");
    expect(player.targetPlatformId).toBe("");
  });

  it("lands on a stable platform", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, player, "3:4", 1, 0);
    expect(resolveLanding(runtime, player)).toBe("landed");
    expect(player.currentPlatformId).toBe("3:4");
  });

  it("lands on a warning platform", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    const target = platform(runtime, "3:4");
    target.state = "warning";
    startHop(runtime, player, "3:4", 1, 0);
    expect(resolveLanding(runtime, player)).toBe("landed");
    expect(player.currentPlatformId).toBe("3:4");
  });

  it("eliminates a player landing on a gone platform", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    const target = platform(runtime, "3:4");
    target.state = "gone";
    startHop(runtime, player, "3:4", 1, 0);
    updateMatch(runtime, runtime.settings.hopDurationMs);
    expect(player.alive).toBe(false);
    expect(player.jumping).toBe(false);
  });

  it("does not eliminate an airborne player when their source disappears", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, player, "3:4", 1, 0);
    eliminatePlayersOnPlatform(runtime, "3:3");
    expect(player.alive).toBe(true);
  });

  it("eliminates grounded players when their platform disappears", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    eliminatePlayersOnPlatform(runtime, "3:3");
    expect(player.alive).toBe(false);
  });
});

describe("platform occupancy", () => {
  it("rejects a hop onto a platform another grounded player occupies", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    addPlayerAt(runtime, "p2", "P2", "3:4");
    expect(validateHop(runtime, player(runtime, "p1"), "3:4", 1)).toBe("target-occupied");
  });

  it("rejects a hop onto a platform another airborne player is targeting", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    const p2 = addPlayerAt(runtime, "p2", "P2", "3:5");
    startHop(runtime, p2, "4:4", 1, 0);
    expect(validateHop(runtime, player(runtime, "p1"), "4:4", 1)).toBe("target-occupied");
  });

  it("accepts a hop onto a platform vacated by an airborne player", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    const p2 = addPlayerAt(runtime, "p2", "P2", "3:4");
    startHop(runtime, p2, "4:4", 1, 0);
    expect(validateHop(runtime, player(runtime, "p1"), "3:4", 1)).toBeNull();
  });

  it("lets a grounded player hop away while another player targets their platform", () => {
    const runtime = makeRuntime();
    const p1 = addPlayerAt(runtime, "p1", "P1", "3:3");
    const p2 = addPlayerAt(runtime, "p2", "P2", "3:5");
    startHop(runtime, p2, "3:3", 1, 0);
    expect(validateHop(runtime, p1, "4:3", 1)).toBeNull();
  });

  it("does not count an eliminated player as occupying a platform", () => {
    const runtime = makeRuntime();
    const p1 = addPlayerAt(runtime, "p1", "P1", "3:3");
    const p2 = addPlayerAt(runtime, "p2", "P2", "3:4");
    p2.alive = false;
    expect(validateHop(runtime, p1, "3:4", 1)).toBeNull();
  });
});
