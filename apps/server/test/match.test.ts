import { describe, expect, it } from "vitest";
import { startHop } from "../src/game/hopping.js";
import {
  addPlayer,
  eliminatePlayer,
  evaluateMatchEnd,
  removePlayer,
  returnToLobby,
  startMatch,
  updateMatch,
} from "../src/game/match.js";
import { addPlayerAt, makeRuntime, platform, player } from "./helpers.js";

describe("match results", () => {
  it("declares the last survivor the winner", () => {
    const runtime = makeRuntime();
    const winner = addPlayerAt(runtime, "p1", "P1", "3:3");
    const loser = addPlayerAt(runtime, "p2", "P2", "3:4");
    eliminatePlayer(runtime, loser);
    updateMatch(runtime, 100);
    expect(runtime.phase).toBe("results");
    expect(runtime.winnerSessionId).toBe(winner.sessionId);
    expect(runtime.draw).toBe(false);
    expect(runtime.aliveCount).toBe(1);
  });

  it("declares a draw when no survivors remain", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    addPlayerAt(runtime, "p2", "P2", "3:4");
    eliminatePlayer(runtime, player(runtime, "p1"));
    eliminatePlayer(runtime, player(runtime, "p2"));
    updateMatch(runtime, 100);
    expect(runtime.phase).toBe("results");
    expect(runtime.draw).toBe(true);
    expect(runtime.winnerSessionId).toBe("");
  });

  it("processes all same-update eliminations before deciding the result", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    addPlayerAt(runtime, "p2", "P2", "3:4");
    platform(runtime, "3:3").state = "warning";
    platform(runtime, "3:3").goneAt = 100;
    platform(runtime, "3:4").state = "warning";
    platform(runtime, "3:4").goneAt = 100;
    updateMatch(runtime, 100);
    expect(runtime.phase).toBe("results");
    expect(runtime.draw).toBe(true);
  });

  it("eliminates a player whose target disappears in the same update as landing", () => {
    const runtime = makeRuntime();
    const jumper = addPlayerAt(runtime, "p1", "P1", "3:3");
    startHop(runtime, jumper, "3:4", 1, 0);
    platform(runtime, "3:4").state = "warning";
    platform(runtime, "3:4").goneAt = 400;
    updateMatch(runtime, 400);
    expect(jumper.alive).toBe(false);
    expect(runtime.phase).toBe("results");
  });

  it("returns results to the lobby", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    runtime.resultsEndsAt = 100;
    runtime.phase = "results";
    runtime.winnerSessionId = "p1";
    updateMatch(runtime, 100);
    expect(runtime.phase).toBe("lobby");
    expect(runtime.winnerSessionId).toBe("");
    expect(runtime.draw).toBe(false);
    expect(runtime.platforms.size).toBe(0);
  });

  it("resets round state but keeps the room intact", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    player.jumping = true;
    player.targetPlatformId = "3:4";
    runtime.roundNumber = 3;
    returnToLobby(runtime);
    expect(runtime.phase).toBe("lobby");
    expect(runtime.roundNumber).toBe(3);
    expect(runtime.players.size).toBe(1);
    expect(player.participating).toBe(false);
    expect(player.alive).toBe(false);
    expect(player.jumping).toBe(false);
    expect(player.currentPlatformId).toBe("");
    expect(runtime.aliveCount).toBe(0);
  });

  it("requires at least two players unless solo is allowed", () => {
    const runtime = makeRuntime({ allowSolo: false });
    runtime.phase = "lobby";
    runtime.players.clear();
    addPlayer(runtime, "p1", "P1", 0);
    expect(startMatch(runtime, 0)).toBe(false);
    expect(runtime.phase).toBe("lobby");
  });

  it("starts a solo match when allowed", () => {
    const runtime = makeRuntime({ allowSolo: true });
    runtime.phase = "lobby";
    runtime.players.clear();
    addPlayer(runtime, "p1", "P1", 0);
    expect(startMatch(runtime, 0)).toBe(true);
    expect(runtime.phase).toBe("countdown");
  });

  it("uses a fresh seed for every round in the same room", () => {
    const runtime = makeRuntime();
    runtime.phase = "lobby";
    runtime.players.clear();
    addPlayer(runtime, "p1", "P1", 0);
    addPlayer(runtime, "p2", "P2", 1);
    expect(startMatch(runtime, 0)).toBe(true);
    const firstSeed = runtime.seed;
    runtime.phase = "lobby";
    expect(startMatch(runtime, 1_000)).toBe(true);
    expect(runtime.seed).not.toBe(firstSeed);
  });
});

describe("room membership", () => {
  it("makes players joining during a match spectators", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "p1", "P1", "3:3");
    const late = addPlayer(runtime, "p2", "P2", 1);
    expect(late.participating).toBe(false);
    expect(late.alive).toBe(false);
  });

  it("removes a player from the runtime on permanent leave", () => {
    const runtime = makeRuntime();
    runtime.phase = "lobby";
    addPlayer(runtime, "p1", "P1", 0);
    addPlayer(runtime, "p2", "P2", 1);
    removePlayer(runtime, "p1", 0);
    expect(runtime.players.has("p1")).toBe(false);
  });

  it("removes a player and evaluates the result on permanent leave during a match", () => {
    const runtime = makeRuntime();
    const player = addPlayerAt(runtime, "p1", "P1", "3:3");
    addPlayerAt(runtime, "p2", "P2", "3:4");
    removePlayer(runtime, "p1", 0);
    expect(runtime.players.has("p1")).toBe(false);
    expect(player.participating).toBe(true);
    expect(runtime.phase).toBe("results");
    expect(runtime.winnerSessionId).toBe("p2");
  });

  it("does not evaluate match end outside the playing phase", () => {
    const runtime = makeRuntime();
    runtime.phase = "countdown";
    addPlayerAt(runtime, "p1", "P1", "3:3");
    evaluateMatchEnd(runtime, 0);
    expect(runtime.phase).toBe("countdown");
  });
});
