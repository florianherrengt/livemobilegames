import { describe, expect, it } from "vitest";

import { GOLF_SERVER_CONSTANTS } from "../../../src/games/golf-race/constants.js";
import { loadGolfCourse } from "../../../src/games/golf-race/course.js";
import {
  addPlayer,
  collisionImmune,
  resetForNewMatch,
  startMatch,
  submitShot,
  updateRuntime,
} from "../../../src/games/golf-race/engine.js";
import { addPlayers, beginMatch, makeGolfRuntime, playerAt, shoot } from "./helpers.js";

function settleShot(runtime: ReturnType<typeof makeGolfRuntime>, now: number): number {
  let t = now;
  for (let guard = 0; guard < 20_000; guard++) {
    updateRuntime(runtime, t);
    if (runtime.phase !== "simulating") {
      return t;
    }
    t += 50;
  }
  throw new Error("shot never settled");
}

describe("Golf engine match setup", () => {
  it("places every player on a fixed starting grid and starts a countdown", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 3);
    beginMatch(runtime, 0);

    expect(runtime.phase).toBe("countdown");
    expect(runtime.roundNumber).toBe(1);
    for (const player of runtime.players.values()) {
      const start = runtime.course.startingPositions[player.joinedOrder];
      expect(player.x).toBe(start?.x);
      expect(player.y).toBe(start?.y);
      expect(player.color).not.toBe("");
      expect(player.finished).toBe(false);
      expect(player.latestGateIndex).toBe(-1);
    }
  });

  it("requires at least the minimum number of connected players", () => {
    const runtime = makeGolfRuntime();
    addPlayer(runtime, "solo", "Solo", 0);
    expect(startMatch(runtime, 0)).toBe(false);
    expect(runtime.phase).toBe("lobby");
  });

  it("resets a completed match for play again", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    alice.finished = true;
    alice.finishedRank = 1;
    resetForNewMatch(runtime);
    expect(runtime.phase).toBe("lobby");
    expect(runtime.roundNumber).toBe(0);
    expect(alice.finished).toBe(false);
    expect(alice.finishedRank).toBe(0);
    expect(alice.x).toBe(runtime.course.startingPositions[0]?.x);
  });
});

describe("Golf turn and round order", () => {
  it("uses fixed seat order in the first pass and progress order in later passes", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);

    // Countdown completes at 700ms in E2E mode.
    updateRuntime(runtime, 700);
    expect(runtime.phase).toBe("aiming");
    expect(runtime.currentTurnSessionId).toBe("player-0");

    // Alice takes a small shot; Bob takes a full diagonal shot through the
    // narrow sections, so Bob is ahead.
    shoot(runtime, "player-0", 750, 1, 0, 30);
    let t = settleShot(runtime, 800);
    expect(runtime.currentTurnSessionId).toBe("player-1");
    shoot(runtime, "player-1", t, 1, -121, 184);
    t = settleShot(runtime, t);

    // The next pass of round 1 must order the furthest behind first: Alice.
    updateRuntime(runtime, t);
    expect(runtime.roundNumber).toBe(1);
    expect(runtime.currentTurnSessionId).toBe("player-0");
    expect(runtime.turnOrder).toEqual(["player-0", "player-1"]);
  });

  it("breaks equal progress ties with fixed seat order", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    for (const player of runtime.players.values()) {
      player.raceProgress = 42;
    }
    updateRuntime(runtime, 700);
    expect(runtime.turnOrder).toEqual(["player-0", "player-1"]);
    expect(runtime.currentTurnSessionId).toBe("player-0");
  });

  it("skips a turn when the aiming timer expires", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    updateRuntime(runtime, 700);
    expect(runtime.phase).toBe("aiming");
    expect(runtime.currentTurnSessionId).toBe("player-0");

    updateRuntime(runtime, 700 + GOLF_SERVER_CONSTANTS.E2E_AIM_MS + 1);
    expect(runtime.phase).toBe("aiming");
    expect(runtime.currentTurnSessionId).toBe("player-1");
    expect(playerAt(runtime, "player-0").playedThisRound).toBe(true);
  });

  it("gives each player one turn per pass and keeps the round going until everyone finishes", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 3);
    beginMatch(runtime, 0);
    updateRuntime(runtime, 700);

    const shotTurn: string[] = [];
    let t = 700;
    for (let guard = 0; guard < 200 && shotTurn.length < 3; guard++) {
      if (runtime.phase === "aiming") {
        shotTurn.push(runtime.currentTurnSessionId);
        shoot(runtime, runtime.currentTurnSessionId, t, 1);
        t = settleShot(runtime, t);
      }
      t += 50;
      updateRuntime(runtime, t);
    }
    expect(shotTurn).toEqual(["player-0", "player-1", "player-2"]);
    expect(runtime.roundNumber).toBe(1);
  });
});

describe("Golf shot validation", () => {
  it("accepts only the active player's shot with valid power and sequence", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    updateRuntime(runtime, 700);

    expect(shoot(runtime, "player-1", 700, 1)).toBe("not-your-turn");
    expect(shoot(runtime, "player-0", 700, 1, 0, 10)).toBe("below-minimum-power");
    expect(shoot(runtime, "player-0", 700, 1, 0, 220)).toBeNull();
    expect(runtime.phase).toBe("simulating");
    expect(playerAt(runtime, "player-0").shotTakenThisTurn).toBe(true);

    // Duplicate and stale sequences are rejected.
    expect(shoot(runtime, "player-0", 700, 1, 0, 220)).toBe("not-aiming");
  });

  it("rejects stale, duplicate, old-round, and ball-moving shots", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    updateRuntime(runtime, 700);

    expect(
      submitShot(runtime, "player-0", { sequence: 99, roundNumber: 99, aimX: 0, aimY: 220 }, 700),
    ).toBe("old-round");
    expect(shoot(runtime, "player-0", 700, 1, 0, 220)).toBeNull();
    expect(shoot(runtime, "player-0", 700, 1, 0, 220)).toBe("not-aiming");
  });

  it("ignores finished players and missing players", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    alice.finished = true;
    updateRuntime(runtime, 700);
    expect(runtime.currentTurnSessionId).toBe("player-1");
    expect(shoot(runtime, "player-0", 700, 1)).toBe("not-your-turn");
    expect(shoot(runtime, "ghost", 700, 1)).toBe("not-your-turn");
  });
});

describe("Golf physics, hazards, and progress", () => {
  it("moves the active ball and waits for every ball to stop before the next turn", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    updateRuntime(runtime, 700);
    const alice = playerAt(runtime, "player-0");
    const aliceStartY = alice.y;
    expect(shoot(runtime, alice.sessionId, 700, 1, 0, 220)).toBeNull();
    expect(runtime.phase).toBe("simulating");
    settleShot(runtime, 750);
    expect(alice.y).toBeLessThan(aliceStartY);
    expect(alice.moving).toBe(false);
    expect(runtime.phase).toBe("aiming");
    expect(runtime.currentTurnSessionId).toBe("player-1");
  });

  it("knocks another ball, which can fall into a hazard and respawn with immunity", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    const bob = playerAt(runtime, "player-1");
    alice.x = 500;
    alice.y = 1700;
    bob.x = 500;
    bob.y = 1600;
    updateRuntime(runtime, 700);
    expect(runtime.currentTurnSessionId).toBe("player-0");

    // Shoot downward (drag upward) so Alice hits Bob down into the hazard.
    expect(shoot(runtime, alice.sessionId, 700, 1, 0, 220)).toBeNull();
    settleShot(runtime, 750);
    expect(bob.x).toBe(600);
    expect(bob.y).toBe(runtime.course.respawnPositions[0]?.y);
    expect(bob.protectedNextTurn).toBe(true);
    expect(collisionImmune(bob, 10_000)).toBe(true);
  });

  it("respawns at the latest unlocked respawn and preserves gate progress", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    alice.latestGateIndex = 1;
    alice.x = 500;
    alice.y = 1200;
    runtime.phase = "simulating";
    updateRuntime(runtime, 100);

    const mid = runtime.course.respawnPositions.find((position) => position.id === "mid");
    expect(alice.x).toBe(mid?.x);
    expect(alice.y).toBe(mid?.y);
    expect(alice.latestGateIndex).toBe(1);
    expect(alice.collisionImmunityUntil).toBeGreaterThan(100);
  });

  it("advances gates only in order", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    alice.latestGateIndex = 0;
    alice.x = 600;
    alice.y = 1200;
    alice.vx = 0;
    alice.vy = -900;
    alice.moving = true;
    runtime.phase = "simulating";
    for (let step = 0; step < 60 && runtime.phase === "simulating"; step++) {
      updateRuntime(runtime, 50 * (step + 1));
    }
    expect(alice.latestGateIndex).toBeGreaterThanOrEqual(2);
  });

  it("does not credit a gate skipped by a shortcut", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    alice.latestGateIndex = 0;
    alice.x = 600;
    alice.y = 900;
    alice.vx = 0;
    alice.vy = -900;
    alice.moving = true;
    runtime.phase = "simulating";
    updateRuntime(runtime, 100);
    expect(alice.latestGateIndex).toBe(0);
  });

  it("counts the finish only after every gate and in the valid direction", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    alice.latestGateIndex = runtime.course.progressGates.length - 1;
    alice.x = 600;
    alice.y = 300;
    alice.vx = 0;
    alice.vy = -900;
    alice.moving = true;
    runtime.phase = "simulating";
    updateRuntime(runtime, 300);
    expect(alice.finished).toBe(true);
    expect(alice.finishedRank).toBe(1);

    const runtime2 = makeGolfRuntime();
    addPlayers(runtime2, 2);
    beginMatch(runtime2, 0);
    const bob = playerAt(runtime2, "player-0");
    bob.latestGateIndex = 1;
    bob.x = 600;
    bob.y = 300;
    bob.vx = 0;
    bob.vy = -900;
    bob.moving = true;
    runtime2.phase = "simulating";
    updateRuntime(runtime2, 300);
    expect(bob.finished).toBe(false);

    const runtime3 = makeGolfRuntime();
    addPlayers(runtime3, 2);
    beginMatch(runtime3, 0);
    const carol = playerAt(runtime3, "player-0");
    carol.latestGateIndex = runtime3.course.progressGates.length - 1;
    carol.x = 600;
    carol.y = 150;
    carol.vx = 0;
    carol.vy = 900;
    carol.moving = true;
    runtime3.phase = "simulating";
    updateRuntime(runtime3, 300);
    expect(carol.finished).toBe(false);
  });

  it("counts a finish when another player knocks the ball across the line", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    const bob = playerAt(runtime, "player-1");
    alice.latestGateIndex = runtime.course.progressGates.length - 1;
    bob.latestGateIndex = runtime.course.progressGates.length - 1;
    alice.x = 600;
    alice.y = 300;
    bob.x = 600;
    bob.y = 240;
    updateRuntime(runtime, 700);
    expect(runtime.currentTurnSessionId).toBe("player-0");
    expect(shoot(runtime, "player-0", 700, 1, 0, 220)).toBeNull();
    settleShot(runtime, 750);

    expect(alice.finished).toBe(true);
    expect(bob.finished).toBe(true);
    expect(bob.finishedRank).toBe(1);
    expect(alice.finishedRank).toBe(2);
  });

  it("counts a finish while the player is collision-immune", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const bob = playerAt(runtime, "player-1");
    bob.latestGateIndex = runtime.course.progressGates.length - 1;
    bob.collisionImmunityUntil = 10_000;
    bob.protectedNextTurn = true;
    bob.x = 600;
    bob.y = 240;
    bob.vx = 0;
    bob.vy = -900;
    bob.moving = true;
    runtime.phase = "simulating";
    updateRuntime(runtime, 300);
    expect(bob.finished).toBe(true);
  });

  it("keeps valid gate progress after the ball rolls back behind the gate", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    alice.latestGateIndex = 1;
    alice.x = 600;
    alice.y = 1200;
    runtime.phase = "simulating";
    updateRuntime(runtime, 50);

    expect(alice.latestGateIndex).toBe(1);
    expect(alice.raceProgress).toBeGreaterThan(0);
  });

  it("rejects a shot submitted after the aiming deadline", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    updateRuntime(runtime, 700);
    expect(runtime.phase).toBe("aiming");
    runtime.aimingEndsAt = 699;
    expect(shoot(runtime, "player-0", 700, 1, 0, 220)).toBe("timer-expired");
  });

  it("gives every starting position a clear opening shot to the first gate", () => {
    for (const start of makeGolfRuntime().course.startingPositions) {
      const runtime = makeGolfRuntime();
      addPlayers(runtime, 2);
      beginMatch(runtime, 0);
      const alice = playerAt(runtime, "player-0");
      alice.x = start.x;
      alice.y = start.y;
      updateRuntime(runtime, 700);
      expect(runtime.currentTurnSessionId).toBe("player-0");
      expect(shoot(runtime, "player-0", 700, 1, 0, 220)).toBeNull();
      settleShot(runtime, 750);
      expect(alice.latestGateIndex, `start ${start.x},${start.y}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("separates overlapping stationary balls without creating impulses", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    const bob = playerAt(runtime, "player-1");
    alice.x = 600;
    alice.y = 600;
    bob.x = 618;
    bob.y = 600;
    runtime.phase = "simulating";
    updateRuntime(runtime, 100);
    expect(Math.hypot(alice.x - bob.x, alice.y - bob.y)).toBeGreaterThanOrEqual(36);
    expect(alice.vx).toBe(0);
    expect(alice.vy).toBe(0);
    expect(bob.vx).toBe(0);
    expect(bob.vy).toBe(0);
  });

  it("skips finished players in later rounds and continues the race", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    alice.finished = true;
    alice.finishedRank = 1;
    updateRuntime(runtime, 700);
    expect(runtime.turnOrder).toEqual(["player-1"]);
    expect(runtime.currentTurnSessionId).toBe("player-1");
  });

  it("places a respawned ball at a deterministic free offset when occupied", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    const bob = playerAt(runtime, "player-1");
    bob.x = 600;
    bob.y = 1680;
    alice.latestGateIndex = 0;
    alice.x = 500;
    alice.y = 1200;
    runtime.phase = "simulating";
    updateRuntime(runtime, 100);
    expect(alice.x).not.toBe(bob.x);
    expect(alice.y).not.toBe(bob.y);
    expect(Math.hypot(alice.x - bob.x, alice.y - bob.y)).toBeGreaterThanOrEqual(36);
  });
});

describe("Golf complete match", () => {
  it("runs a deterministic full match to final results", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    let t = 0;
    let maxRound = 0;
    for (let guard = 0; guard < 20_000 && runtime.phase !== "finished"; guard++) {
      updateRuntime(runtime, t);
      maxRound = Math.max(maxRound, runtime.roundNumber);
      if (runtime.phase === "aiming") {
        const player = playerAt(runtime, runtime.currentTurnSessionId);
        const correction = Math.max(-0.3, Math.min(0.3, (600 - player.x) / 800));
        const aimX = -correction * 220;
        const aimY = Math.sqrt(220 * 220 - aimX * aimX);
        const result = shoot(runtime, player.sessionId, t, guard + 1, aimX, aimY);
        if (result !== null) {
          throw new Error(`shot rejected during match: ${result}`);
        }
      }
      t += 50;
    }
    expect(runtime.phase).toBe("finished");
    expect(maxRound).toBe(5);
    expect(runtime.totalRounds).toBe(5);
    expect(runtime.result).not.toBeNull();
    const result = runtime.result;
    if (!result) {
      throw new Error("missing result");
    }
    expect(result.leaderboard).toHaveLength(2);
    expect(result.leaderboard[0]?.rank).toBe(1);
    expect(result.leaderboard[1]?.rank).toBe(2);
    expect(result.winnerSessionIds).toHaveLength(1);
    const points = [...runtime.players.values()].reduce(
      (sum, player) => sum + player.matchPoints,
      0,
    );
    expect(points).toBe(15);
  }, 30_000);

  it("starts progressively harder rounds with expanded hazards", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    const bob = playerAt(runtime, "player-1");
    const roundOneRect = runtime.roundCourse.hazards.find((hazard) => hazard.kind === "rect");
    const roundOneWidth = roundOneRect?.kind === "rect" ? roundOneRect.width : 0;

    alice.latestGateIndex = runtime.course.progressGates.length - 1;
    bob.latestGateIndex = runtime.course.progressGates.length - 1;
    alice.x = 600;
    alice.y = 300;
    bob.x = 600;
    bob.y = 240;
    updateRuntime(runtime, 700);
    expect(runtime.currentTurnSessionId).toBe("player-0");
    expect(shoot(runtime, "player-0", 700, 1, 0, 220)).toBeNull();
    const t = settleShot(runtime, 750);
    expect(runtime.phase).toBe("round-result");
    expect(runtime.roundWinnerSessionIds).toEqual(["player-1"]);

    updateRuntime(runtime, t + 1_000);
    expect(runtime.roundNumber).toBe(2);
    expect(runtime.phase).toBe("aiming");
    const roundTwoRect = runtime.roundCourse.hazards.find((hazard) => hazard.kind === "rect");
    const roundTwoWidth = roundTwoRect?.kind === "rect" ? roundTwoRect.width : 0;
    expect(roundTwoWidth).toBeGreaterThan(roundOneWidth);
  });
});

describe("Golf course data", () => {
  it("loads and validates the initial course", () => {
    const course = loadGolfCourse();
    expect(course.schemaVersion).toBe(1);
    expect(course.startingPositions).toHaveLength(8);
    expect(course.progressGates.length).toBeGreaterThanOrEqual(3);
    expect(course.respawnPositions.length).toBeGreaterThanOrEqual(1);
  });

  it("uses a stable route-based progress measure rather than straight-line distance", () => {
    const runtime = makeGolfRuntime();
    addPlayers(runtime, 2);
    beginMatch(runtime, 0);
    const alice = playerAt(runtime, "player-0");
    const bob = playerAt(runtime, "player-1");
    // Bob is physically closer to the finish but has crossed fewer gates.
    alice.latestGateIndex = 1;
    alice.x = 600;
    alice.y = 900;
    alice.vx = 0;
    alice.vy = -900;
    alice.moving = true;
    bob.latestGateIndex = 0;
    bob.x = 600;
    bob.y = 700;
    bob.vx = 0;
    bob.vy = -900;
    bob.moving = true;
    runtime.phase = "simulating";
    updateRuntime(runtime, 50);
    expect(alice.raceProgress).toBeGreaterThan(bob.raceProgress);
  });
});
