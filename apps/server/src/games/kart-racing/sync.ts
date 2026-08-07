import {
  KartRacingCrateState,
  KartRacingLeaderboardEntryState,
  KartRacingMatchResultState,
  KartRacingPlayerState,
  KartRacingProjectileState,
  KartRacingRaceResultEntryState,
  type KartRacingState,
} from "@phone-party/protocol";

import type { KartRacingRuntime, RuntimePlayer } from "./types.js";

function copyPlayer(
  target: KartRacingPlayerState,
  source: RuntimePlayer,
  now: number,
  lapsPerRace: number,
): void {
  target.name = source.name;
  target.connectionStatus = source.removed
    ? "disconnected"
    : source.connected
      ? "connected"
      : "reconnecting";
  target.joinedOrder = source.joinedOrder;
  target.color = source.color;
  target.matchPoints = source.matchPoints;
  target.raceWins = source.raceWins;
  target.secondPlaces = source.secondPlaces;
  target.thirdPlaces = source.thirdPlaces;
  target.totalRaceTimeMs = source.totalRaceTimeMs;
  target.kartX = source.x;
  target.kartY = source.y;
  target.kartHeading = source.heading;
  target.kartSpeed = source.speed;
  target.raceActive = source.raceActive;
  target.active = source.active;
  target.finished = source.finished;
  target.timedOut = source.timedOut;
  target.removed = source.removed;
  target.lap = source.raceActive ? Math.min(source.completedLaps + 1, lapsPerRace) : 0;
  target.checkpointsPassed = source.nextCheckpointIndex;
  target.racePosition = source.racePosition;
  target.finishPosition = source.finishPosition;
  target.finishTimeMs = source.finishTimeMs;
  target.racePoints = source.racePoints;
  target.ammoLoaded = source.ammoLoaded;
  target.hitStopRemainingMs = Math.max(0, source.hitStopUntil - now);
  target.immunityRemainingMs = Math.max(
    0,
    Math.max(source.immunityUntil, source.respawnImmunityUntil) - now,
  );
  target.respawnRemainingMs = Math.max(0, source.respawnUntil - now);
  target.wrongWay = source.wrongWay;
  target.collectedCrateIds.clear();
  for (const crateId of source.collectedCrateIds) {
    target.collectedCrateIds.push(crateId);
  }
}

function toResultState(result: KartRacingRuntime["result"]): KartRacingMatchResultState | null {
  if (result === null) {
    return null;
  }
  const state = new KartRacingMatchResultState();
  for (const sessionId of result.winnerSessionIds) {
    state.winnerSessionIds.push(sessionId);
  }
  for (const entry of result.leaderboard) {
    const leaderboardEntry = new KartRacingLeaderboardEntryState();
    leaderboardEntry.sessionId = entry.sessionId;
    leaderboardEntry.label = entry.label;
    leaderboardEntry.rank = entry.rank;
    leaderboardEntry.matchPoints = entry.matchPoints;
    leaderboardEntry.raceWins = entry.raceWins;
    leaderboardEntry.totalRaceTimeMs = entry.totalRaceTimeMs;
    state.leaderboard.push(leaderboardEntry);
  }
  return state;
}

/**
 * Project the server-only runtime onto the synchronized schema. This is the
 * only place that writes client-facing Kart Racing state, and it never exposes
 * the seed, RNG, pending input, sequence windows, rate-limit state, respawn
 * points, or simulation accumulators.
 */
export function syncKartRacingState(
  state: KartRacingState,
  runtime: KartRacingRuntime,
  now: number,
): void {
  state.phase = runtime.phase;
  state.raceNumber = runtime.raceNumber;
  state.totalRaces = runtime.totalRaces;
  state.lapsPerRace = runtime.settings.config.LAPS_PER_RACE;
  state.countdownEndsAt = runtime.phase === "countdown" ? runtime.countdownEndsAt : 0;
  state.raceStartedAt = runtime.phase === "racing" ? runtime.raceStartedAt : 0;
  state.raceFinishTimeoutEndsAt = runtime.phase === "racing" ? runtime.raceFinishTimeoutEndsAt : 0;
  state.resultsEndsAt =
    runtime.phase === "race-result" || runtime.phase === "finished" ? runtime.resultsEndsAt : 0;
  state.trackId = runtime.track.id;
  state.trackName = runtime.track.name;

  state.crates.clear();
  for (const crate of runtime.activeCrates) {
    const crateState = new KartRacingCrateState();
    crateState.id = crate.id;
    crateState.x = crate.x;
    crateState.y = crate.y;
    state.crates.push(crateState);
  }

  state.projectiles.clear();
  for (const projectile of runtime.projectiles) {
    const projectileState = new KartRacingProjectileState();
    projectileState.id = projectile.id;
    projectileState.ownerSessionId = projectile.ownerSessionId;
    projectileState.x = projectile.x;
    projectileState.y = projectile.y;
    projectileState.heading = projectile.heading;
    projectileState.remainingMs = Math.max(0, projectile.remainingMs);
    state.projectiles.push(projectileState);
  }

  for (const [sessionId, player] of runtime.players) {
    let playerState = state.players.get(sessionId);
    if (!playerState) {
      playerState = new KartRacingPlayerState();
      state.players.set(sessionId, playerState);
    }
    copyPlayer(playerState, player, now, runtime.settings.config.LAPS_PER_RACE);
  }
  for (const key of [...state.players.keys()]) {
    if (!runtime.players.has(key)) {
      state.players.delete(key);
    }
  }

  if (runtime.phase === "race-result") {
    state.raceResult.clear();
    for (const entry of runtime.raceResult ?? []) {
      const entryState = new KartRacingRaceResultEntryState();
      entryState.sessionId = entry.sessionId;
      entryState.label = entry.label;
      entryState.position = entry.position;
      entryState.points = entry.points;
      entryState.finishTimeMs = entry.finishTimeMs;
      entryState.timedOut = entry.timedOut;
      state.raceResult.push(entryState);
    }
  } else {
    state.raceResult.clear();
  }

  if (runtime.phase === "racing") {
    state.raceFinishOrder.clear();
    for (const sessionId of runtime.raceFinishOrder) {
      state.raceFinishOrder.push(sessionId);
    }
  } else {
    state.raceFinishOrder.clear();
  }

  const resultState = toResultState(runtime.result);
  if (resultState === null) {
    state.result = null;
  } else if (state.result === null) {
    state.result = resultState;
  }
}
