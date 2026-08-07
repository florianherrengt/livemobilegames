import { GOLF_COURSE } from "@phone-party/protocol";

import { loadGolfCourse } from "../../../src/games/golf-race/course.js";
import {
  addPlayer,
  createRuntime,
  createSettings,
  startMatch,
  submitShot,
  updateRuntime,
} from "../../../src/games/golf-race/engine.js";
import type { GolfRuntime, RuntimePlayer } from "../../../src/games/golf-race/types.js";

export function makeGolfRuntime(e2eMode = true): GolfRuntime {
  return createRuntime(createSettings(e2eMode), loadGolfCourse());
}

export function addPlayers(
  runtime: GolfRuntime,
  count: number,
  namePrefix = "Player",
): RuntimePlayer[] {
  return Array.from({ length: count }, (_, index) =>
    addPlayer(runtime, `${namePrefix.toLowerCase()}-${index}`, `${namePrefix} ${index}`, index),
  );
}

export function beginMatch(runtime: GolfRuntime, now = 0): void {
  if (!startMatch(runtime, now)) {
    throw new Error("Failed to start match");
  }
}

export function shoot(
  runtime: GolfRuntime,
  sessionId: string,
  now: number,
  sequence = 1,
  aimX = 0,
  aimY = 220,
): ReturnType<typeof submitShot> {
  return submitShot(
    runtime,
    sessionId,
    { sequence, roundNumber: runtime.roundNumber, aimX, aimY },
    now,
  );
}

/** Advances time and shoots for whoever is aiming until `now` is reached. */
export function runUntil(
  runtime: GolfRuntime,
  from: number,
  to: number,
  shotFor: (player: RuntimePlayer) => { aimX: number; aimY: number } | null = () => ({
    aimX: 0,
    aimY: 220,
  }),
): void {
  let now = from;
  while (now <= to) {
    updateRuntime(runtime, now);
    if (runtime.phase === "aiming") {
      const player = runtime.players.get(runtime.currentTurnSessionId);
      if (player) {
        const aim = shotFor(player);
        if (aim) {
          shoot(runtime, player.sessionId, now, nextSequence(player));
        }
      }
    }
    now += 50;
  }
}

let sequenceCounter = 0;
function nextSequence(_player: RuntimePlayer): number {
  sequenceCounter += 1;
  return sequenceCounter;
}

export function playerAt(runtime: GolfRuntime, sessionId: string): RuntimePlayer {
  const player = runtime.players.get(sessionId);
  if (!player) {
    throw new Error(`missing player ${sessionId}`);
  }
  return player;
}

export { GOLF_COURSE };
