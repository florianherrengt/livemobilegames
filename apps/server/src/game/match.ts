import {
  computeArenaSide,
  E2E_MATCH_SEED,
  type MatchRuntime,
  type MatchSettings,
  platformId,
  type RuntimePlayer,
} from "@falling-platforms/shared";
import seedrandom from "seedrandom";

import { resolveLanding } from "./hopping.js";
import { selectAndWarnPlatforms, transitionWarningsToGone } from "./platforms.js";
import { createPlatforms, selectSpawns } from "./spawning.js";

export function createRuntime(settings: MatchSettings): MatchRuntime {
  return {
    phase: "lobby",
    winnerSessionId: "",
    draw: false,
    roundNumber: 0,
    aliveCount: 0,
    arenaSide: 0,
    matchStartedAt: 0,
    countdownEndsAt: 0,
    resultsEndsAt: 0,
    nextWarningAt: 0,
    firstRemovalCycleDone: false,
    resultsNotified: false,
    seed: "",
    rng: Math.random,
    players: new Map(),
    platforms: new Map(),
    settings,
  };
}

export function addPlayer(
  runtime: MatchRuntime,
  sessionId: string,
  name: string,
  joinedOrder: number,
): RuntimePlayer {
  const player: RuntimePlayer = {
    sessionId,
    name,
    connected: true,
    participating: false,
    alive: false,
    jumping: false,
    currentPlatformId: "",
    fromPlatformId: "",
    targetPlatformId: "",
    jumpStartedAt: 0,
    jumpEndsAt: 0,
    lastAcceptedSequence: 0,
    joinedOrder,
  };
  runtime.players.set(sessionId, player);
  return player;
}

export function eliminatePlayer(_runtime: MatchRuntime, player: RuntimePlayer): void {
  player.alive = false;
  player.jumping = false;
  player.fromPlatformId = "";
  player.targetPlatformId = "";
  player.jumpStartedAt = 0;
  player.jumpEndsAt = 0;
}

/** Eliminates every grounded player standing on the given platform. */
export function eliminatePlayersOnPlatform(runtime: MatchRuntime, platformId: string): void {
  for (const player of runtime.players.values()) {
    if (
      player.participating &&
      player.alive &&
      !player.jumping &&
      player.currentPlatformId === platformId
    ) {
      eliminatePlayer(runtime, player);
    }
  }
}

/** Starts the countdown for a new round. Returns false when not enough players. */
export function startMatch(runtime: MatchRuntime, now: number): boolean {
  const participants = [...runtime.players.values()].filter((player) => player.connected);
  const required = runtime.settings.allowSolo ? 1 : 2;
  if (participants.length < required) {
    return false;
  }

  // A fresh seed per round (fixed only in E2E test mode) so consecutive
  // matches in the same room do not play out identically.
  runtime.seed = runtime.settings.e2eMode ? E2E_MATCH_SEED : `seed-${Date.now()}-${Math.random()}`;
  runtime.rng = seedrandom(runtime.seed);

  const arenaSide = computeArenaSide(participants.length);
  const platforms = createPlatforms(arenaSide);
  const spawns = selectSpawns(
    arenaSide,
    participants.length,
    runtime.rng,
    runtime.settings.e2eMode,
  );

  participants.sort((a, b) => a.joinedOrder - b.joinedOrder);
  participants.forEach((player, index) => {
    player.participating = true;
    player.alive = true;
    player.jumping = false;
    player.currentPlatformId = spawns[index] ?? platformId(0, 0);
    player.fromPlatformId = "";
    player.targetPlatformId = "";
    player.jumpStartedAt = 0;
    player.jumpEndsAt = 0;
    player.lastAcceptedSequence = 0;
  });
  for (const player of runtime.players.values()) {
    if (!player.connected) {
      player.participating = false;
      player.alive = false;
    }
  }

  runtime.platforms = new Map(platforms.map((platform) => [platform.id, platform]));
  runtime.arenaSide = arenaSide;
  runtime.aliveCount = participants.length;
  runtime.roundNumber += 1;
  runtime.firstRemovalCycleDone = false;
  runtime.phase = "countdown";
  runtime.countdownEndsAt = now + runtime.settings.countdownMs;
  return true;
}

export function startPlaying(runtime: MatchRuntime, now: number): void {
  runtime.phase = "playing";
  runtime.matchStartedAt = now;
  runtime.nextWarningAt = now + runtime.settings.initialSafePeriodMs;
}

export function recomputeAliveCount(runtime: MatchRuntime): void {
  let count = 0;
  for (const player of runtime.players.values()) {
    if (player.participating && player.alive) {
      count += 1;
    }
  }
  runtime.aliveCount = count;
}

/**
 * Evaluates the match only after every event in an update has been processed.
 * One survivor wins; zero survivors is a draw.
 */
export function evaluateMatchEnd(runtime: MatchRuntime, now: number): void {
  if (runtime.phase !== "playing") {
    return;
  }
  const survivors = [...runtime.players.values()].filter(
    (player) => player.participating && player.alive,
  );
  if (survivors.length === 1) {
    runtime.phase = "results";
    runtime.winnerSessionId = survivors[0]?.sessionId ?? "";
    runtime.draw = false;
    runtime.resultsEndsAt = now + runtime.settings.resultsDisplayMs;
  } else if (survivors.length === 0) {
    runtime.phase = "results";
    runtime.winnerSessionId = "";
    runtime.draw = true;
    runtime.resultsEndsAt = now + runtime.settings.resultsDisplayMs;
  }
}

/**
 * The deterministic per-tick pipeline. Order matters: platform disappearance
 * and its grounded eliminations are processed before jump landings, so a
 * platform that disappears in the same update as a landing eliminates the
 * player who lands on it.
 */
export function updateMatch(runtime: MatchRuntime, now: number): void {
  if (runtime.phase === "countdown") {
    if (now >= runtime.countdownEndsAt) {
      startPlaying(runtime, now);
    }
    return;
  }
  if (runtime.phase === "results") {
    if (now >= runtime.resultsEndsAt) {
      returnToLobby(runtime);
    }
    return;
  }
  if (runtime.phase !== "playing") {
    return;
  }

  const goneIds = transitionWarningsToGone(runtime, now);
  for (const id of goneIds) {
    eliminatePlayersOnPlatform(runtime, id);
  }

  for (const player of runtime.players.values()) {
    if (player.participating && player.alive && player.jumping && now >= player.jumpEndsAt) {
      if (resolveLanding(runtime, player) === "eliminated") {
        eliminatePlayer(runtime, player);
      }
    }
  }

  if (now >= runtime.nextWarningAt) {
    selectAndWarnPlatforms(runtime, now);
  }

  recomputeAliveCount(runtime);
  evaluateMatchEnd(runtime, now);
}

/** Resets all transient round state and returns everyone to the lobby. */
export function returnToLobby(runtime: MatchRuntime): void {
  runtime.phase = "lobby";
  runtime.winnerSessionId = "";
  runtime.draw = false;
  runtime.aliveCount = 0;
  runtime.arenaSide = 0;
  runtime.matchStartedAt = 0;
  runtime.countdownEndsAt = 0;
  runtime.resultsEndsAt = 0;
  runtime.nextWarningAt = 0;
  runtime.firstRemovalCycleDone = false;
  runtime.platforms.clear();

  for (const player of runtime.players.values()) {
    player.participating = false;
    player.alive = false;
    player.jumping = false;
    player.currentPlatformId = "";
    player.fromPlatformId = "";
    player.targetPlatformId = "";
    player.jumpStartedAt = 0;
    player.jumpEndsAt = 0;
    player.lastAcceptedSequence = 0;
  }
}

/**
 * Removes a permanently departed player from the runtime so the round can
 * still finish. The platform owns the player row and host transfer.
 */
export function removePlayer(runtime: MatchRuntime, sessionId: string, now: number): void {
  const player = runtime.players.get(sessionId);
  if (!player) {
    return;
  }
  runtime.players.delete(sessionId);
  recomputeAliveCount(runtime);
  if (runtime.phase === "playing") {
    evaluateMatchEnd(runtime, now);
  }
}
