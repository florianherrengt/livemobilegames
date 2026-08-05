import type { Client, Room } from "@colyseus/sdk";
import {
  type CapitalPinPhase,
  CapitalPinPlayerState,
  CapitalPinResultState,
  type CapitalPinState,
  CapitalPinState as CapitalPinStateClass,
  GuessResultState,
  LeaderboardEntryState,
  RoundResultState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

/** Deterministic Capital Pin state for Storybook and component tests. */
export function makeCapitalPinState(
  phase: CapitalPinPhase,
  options: {
    roundNumber?: number;
    totalRounds?: number;
    currentCapitalName?: string;
    roundEndsAt?: number;
    hostSessionId?: string;
    submitted?: boolean;
    lastResult?: RoundResultState | null;
    result?: CapitalPinResultState | null;
  } = {},
): CapitalPinState {
  const state = new CapitalPinStateClass();
  state.roomCode = "ABC234";
  state.gameId = "capital-pin";
  state.phase = phase;
  state.roundNumber = options.roundNumber ?? 1;
  state.totalRounds = options.totalRounds ?? 10;
  state.currentCapitalName = options.currentCapitalName ?? "Paris";
  state.roundEndsAt = options.roundEndsAt ?? Date.now() + 45_000;
  state.hostSessionId = options.hostSessionId ?? "host-session";
  state.lastResult = options.lastResult ?? null;
  state.result = options.result ?? null;

  const alice = new CapitalPinPlayerState();
  alice.playerId = "player-alice";
  alice.name = "Alice";
  alice.isHost = true;
  alice.connectionStatus = "connected";
  alice.submitted = options.submitted ?? false;
  state.players.set("host-session", alice);

  const bob = new CapitalPinPlayerState();
  bob.playerId = "player-bob";
  bob.name = "Bob";
  bob.connectionStatus = "connected";
  state.players.set("bob-session", bob);
  return state;
}

export function makeRoundResult(): RoundResultState {
  const result = new RoundResultState();
  result.roundNumber = 1;
  result.capitalName = "Paris";
  result.country = "France";
  result.correctLatitude = 48.8566;
  result.correctLongitude = 2.3522;
  result.winnerSessionIds.push("host-session");
  const aliceGuess = new GuessResultState();
  aliceGuess.sessionId = "host-session";
  aliceGuess.displayName = "Alice";
  aliceGuess.latitude = 48.85;
  aliceGuess.longitude = 2.35;
  aliceGuess.distanceKm = 0.7;
  aliceGuess.isWinner = true;
  result.guesses.push(aliceGuess);
  const bobGuess = new GuessResultState();
  bobGuess.sessionId = "bob-session";
  bobGuess.displayName = "Bob";
  bobGuess.latitude = 40;
  bobGuess.longitude = 0;
  bobGuess.distanceKm = 1_054;
  bobGuess.isWinner = false;
  result.guesses.push(bobGuess);
  return result;
}

export function makeMatchResult(): CapitalPinResultState {
  const result = new CapitalPinResultState();
  result.finishedAt = Date.now();
  result.winnerSessionIds.push("host-session");
  const alice = new LeaderboardEntryState();
  alice.sessionId = "host-session";
  alice.rank = 1;
  alice.primaryScore = 7;
  alice.label = "Alice";
  result.leaderboard.push(alice);
  const bob = new LeaderboardEntryState();
  bob.sessionId = "bob-session";
  bob.rank = 2;
  bob.primaryScore = 3;
  bob.label = "Bob";
  result.leaderboard.push(bob);
  return result;
}

/** A fake connection whose room records sent messages for assertions. */
export function makeRoomConnection(state: CapitalPinState) {
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
