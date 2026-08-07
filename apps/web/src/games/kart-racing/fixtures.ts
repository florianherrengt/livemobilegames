import type { Client, Room } from "@colyseus/sdk";
import {
  KART_RACING_GAME_ID,
  KART_RACING_TRACK,
  KartRacingCrateState,
  KartRacingLeaderboardEntryState,
  KartRacingMatchResultState,
  type KartRacingPhase,
  KartRacingPlayerState,
  KartRacingRaceResultEntryState,
  KartRacingState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

function addPlayer(
  state: KartRacingState,
  sessionId: string,
  name: string,
  joinedOrder: number,
  color: string,
  options: {
    x?: number;
    y?: number;
    heading?: number;
    speed?: number;
    lap?: number;
    checkpointsPassed?: number;
    racePosition?: number;
    ammoLoaded?: boolean;
    finished?: boolean;
    active?: boolean;
    hitStopRemainingMs?: number;
    immunityRemainingMs?: number;
    respawnRemainingMs?: number;
    matchPoints?: number;
    racePoints?: number;
    connectionStatus?: "connected" | "reconnecting" | "disconnected";
    removed?: boolean;
    wrongWay?: boolean;
  } = {},
): void {
  const player = new KartRacingPlayerState();
  player.name = name;
  player.connectionStatus = options.connectionStatus ?? "connected";
  player.joinedOrder = joinedOrder;
  player.color = color;
  player.kartX = options.x ?? (joinedOrder === 0 ? 600 : 700);
  player.kartY = options.y ?? (joinedOrder === 0 ? 1050 : 985);
  player.kartHeading = options.heading ?? 0;
  player.kartSpeed = options.speed ?? (state.phase === "racing" ? 140 : 0);
  player.lap = options.lap ?? (state.phase === "racing" ? 1 : 0);
  player.checkpointsPassed = options.checkpointsPassed ?? 0;
  player.racePosition = options.racePosition ?? joinedOrder + 1;
  player.ammoLoaded = options.ammoLoaded ?? false;
  player.finished = options.finished ?? false;
  player.active = options.active ?? (state.phase === "racing" || state.phase === "countdown");
  player.removed = options.removed ?? false;
  player.raceActive = !player.removed;
  player.hitStopRemainingMs = options.hitStopRemainingMs ?? 0;
  player.immunityRemainingMs = options.immunityRemainingMs ?? 0;
  player.respawnRemainingMs = options.respawnRemainingMs ?? 0;
  player.matchPoints = options.matchPoints ?? 0;
  player.racePoints = options.racePoints ?? 0;
  player.wrongWay = options.wrongWay ?? false;
  state.players.set(sessionId, player);
}

function addCrates(state: KartRacingState, count = 2): void {
  for (let index = 0; index < count; index++) {
    const crate = new KartRacingCrateState();
    crate.id = `crate-${index}`;
    crate.x = 500 + index * 250;
    crate.y = 1050;
    state.crates.push(crate);
  }
}

/** Deterministic Kart Racing state for Storybook and component tests. */
export function makeKartRacingState(
  phase: KartRacingPhase,
  options: {
    raceNumber?: number;
    hostSessionId?: string;
    aliceAmmo?: boolean;
    bobAmmo?: boolean;
    aliceFinished?: boolean;
    aliceHitStop?: boolean;
    aliceRespawn?: boolean;
    aliceReconnecting?: boolean;
    result?: KartRacingMatchResultState | null;
  } = {},
): KartRacingState {
  const state = new KartRacingState();
  state.roomCode = "ABC234";
  state.gameId = KART_RACING_GAME_ID;
  state.phase = phase;
  state.hostSessionId = options.hostSessionId ?? "host-session";
  state.raceNumber = options.raceNumber ?? (phase === "lobby" ? 0 : 1);
  state.totalRaces = 3;
  state.lapsPerRace = 3;
  state.trackId = KART_RACING_TRACK.id;
  state.trackName = KART_RACING_TRACK.name;
  if (phase === "countdown") {
    state.countdownEndsAt = Date.now() + 2_000;
  }
  if (phase === "racing") {
    state.raceStartedAt = Date.now() - 10_000;
  }
  if (phase === "race-result") {
    state.resultsEndsAt = Date.now() + 3_000;
  }
  if (phase === "countdown" || phase === "racing") {
    addCrates(state);
  }

  addPlayer(state, "host-session", "Alice", 0, "#0072B2", {
    ...(options.aliceAmmo !== undefined ? { ammoLoaded: options.aliceAmmo } : {}),
    ...(options.aliceFinished !== undefined ? { finished: options.aliceFinished } : {}),
    ...(options.aliceHitStop ? { hitStopRemainingMs: 800 } : {}),
    ...(options.aliceRespawn ? { respawnRemainingMs: 700 } : {}),
    ...(options.aliceReconnecting ? { connectionStatus: "reconnecting" as const } : {}),
    racePosition: 1,
  });
  addPlayer(state, "bob-session", "Bob", 1, "#E69F00", {
    ...(options.bobAmmo !== undefined ? { ammoLoaded: options.bobAmmo } : {}),
    racePosition: 2,
  });

  if (phase === "race-result") {
    const aliceEntry = new KartRacingRaceResultEntryState();
    aliceEntry.sessionId = "host-session";
    aliceEntry.label = "Alice";
    aliceEntry.position = 1;
    aliceEntry.points = 8;
    state.raceResult.push(aliceEntry);
    const bobEntry = new KartRacingRaceResultEntryState();
    bobEntry.sessionId = "bob-session";
    bobEntry.label = "Bob";
    bobEntry.position = 2;
    bobEntry.points = 6;
    state.raceResult.push(bobEntry);
    const hostPlayer = state.players.get("host-session");
    const bobPlayer = state.players.get("bob-session");
    if (hostPlayer) {
      hostPlayer.racePoints = 8;
      hostPlayer.matchPoints = 8;
    }
    if (bobPlayer) {
      bobPlayer.racePoints = 6;
      bobPlayer.matchPoints = 6;
    }
  }
  state.result = options.result ?? null;
  return state;
}

export function makeKartRacingResult(options: { tie?: boolean } = {}): KartRacingMatchResultState {
  const result = new KartRacingMatchResultState();
  result.winnerSessionIds.push("host-session");
  if (options.tie) {
    result.winnerSessionIds.push("bob-session");
  }
  const alice = new KartRacingLeaderboardEntryState();
  alice.sessionId = "host-session";
  alice.label = "Alice";
  alice.rank = 1;
  alice.matchPoints = 24;
  alice.raceWins = 2;
  result.leaderboard.push(alice);
  const bob = new KartRacingLeaderboardEntryState();
  bob.sessionId = "bob-session";
  bob.label = "Bob";
  bob.rank = options.tie ? 1 : 2;
  bob.matchPoints = options.tie ? 24 : 18;
  bob.raceWins = options.tie ? 1 : 1;
  result.leaderboard.push(bob);
  return result;
}

/** A fake connection whose room records sent messages for assertions. */
export function makeRoomConnection(state: KartRacingState) {
  const sent: Array<{ type: string; payload: unknown }> = [];
  const room = {
    state,
    sessionId: "host-session",
    send: (type: string, payload?: unknown) => {
      sent.push({ type, payload });
    },
    onMessage: () => () => undefined,
    onError: { once: () => undefined },
  } as unknown as Room<unknown, RoomState>;
  const client = {} as Client;
  const connection = {
    code: "ABC234",
    room,
    client,
    reconnecting: false,
    leave: () => undefined,
  } as unknown as RoomConnection;
  return { connection, sent };
}
