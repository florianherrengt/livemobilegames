import type { Client, Room } from "@colyseus/sdk";
import {
  GOLF_COURSE,
  GOLF_GAME_ID,
  GolfRaceLeaderboardEntryState,
  type GolfRacePhase,
  GolfRacePlayerState,
  GolfRaceResultState,
  GolfRaceState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

function addPlayer(
  state: GolfRaceState,
  sessionId: string,
  name: string,
  joinedOrder: number,
  color: string,
  options: {
    positionX?: number | undefined;
    positionY?: number | undefined;
    finished?: boolean | undefined;
    finishedRank?: number | undefined;
    moving?: boolean | undefined;
    collisionImmune?: boolean | undefined;
    playedThisRound?: boolean | undefined;
    roundWins?: number | undefined;
    matchPoints?: number | undefined;
    connectionStatus?: "connected" | "reconnecting" | "disconnected";
  } = {},
): void {
  const player = new GolfRacePlayerState();
  player.name = name;
  player.joinedOrder = joinedOrder;
  player.color = color;
  player.connectionStatus = options.connectionStatus ?? "connected";
  const start = GOLF_COURSE.startingPositions[joinedOrder] ?? { x: 0, y: 0 };
  player.positionX = options.positionX ?? start.x;
  player.positionY = options.positionY ?? start.y;
  player.finished = options.finished ?? false;
  player.finishedRank = options.finishedRank ?? 0;
  player.moving = options.moving ?? false;
  player.collisionImmune = options.collisionImmune ?? false;
  player.playedThisRound = options.playedThisRound ?? false;
  player.roundWins = options.roundWins ?? 0;
  player.matchPoints = options.matchPoints ?? 0;
  state.players.set(sessionId, player);
}

/** Deterministic Golf state for Storybook and component tests. */
export function makeGolfRaceState(
  phase: GolfRacePhase,
  options: {
    roundNumber?: number | undefined;
    hostSessionId?: string | undefined;
    currentTurnSessionId?: string | undefined;
    aimingEndsAt?: number | undefined;
    countdownEndsAt?: number | undefined;
    aliceFinished?: boolean | undefined;
    bobFinished?: boolean | undefined;
    aliceImmune?: boolean | undefined;
    aliceRoundWins?: number | undefined;
    aliceMatchPoints?: number | undefined;
    bobRoundWins?: number | undefined;
    bobMatchPoints?: number | undefined;
    result?: GolfRaceResultState | null | undefined;
  } = {},
): GolfRaceState {
  const state = new GolfRaceState();
  state.roomCode = "ABC234";
  state.gameId = GOLF_GAME_ID;
  state.phase = phase;
  state.hostSessionId = options.hostSessionId ?? "host-session";
  state.roundNumber = options.roundNumber ?? (phase === "lobby" ? 0 : 1);
  state.totalRounds = 5;
  if (phase === "countdown") {
    state.countdownEndsAt = options.countdownEndsAt ?? Date.now() + 2_000;
  }
  if (phase === "aiming") {
    state.aimingEndsAt = options.aimingEndsAt ?? Date.now() + 5_000;
    state.currentTurnSessionId = options.currentTurnSessionId ?? "host-session";
    state.turnOrder.push("host-session", "bob-session");
  }
  if (phase === "simulating") {
    state.turnOrder.push("host-session", "bob-session");
  }
  if (phase === "round-result") {
    state.resultsEndsAt = Date.now() + 1_000;
    state.roundWinnerSessionIds.push("host-session");
    state.turnOrder.push("host-session", "bob-session");
  }

  addPlayer(state, "host-session", "Alice", 0, "#0072B2", {
    positionY: options.aliceFinished ? 190 : (GOLF_COURSE.startingPositions[0]?.y ?? 0),
    finished: phase === "round-result" ? true : options.aliceFinished,
    finishedRank: phase === "round-result" ? 1 : options.aliceFinished ? 1 : 0,
    collisionImmune: options.aliceImmune,
    roundWins: options.aliceRoundWins,
    matchPoints: options.aliceMatchPoints,
  });
  addPlayer(state, "bob-session", "Bob", 1, "#E69F00", {
    positionY: options.bobFinished ? 195 : (GOLF_COURSE.startingPositions[1]?.y ?? 0),
    finished: phase === "round-result" ? true : options.bobFinished,
    finishedRank: phase === "round-result" ? 2 : options.bobFinished ? 2 : 0,
    roundWins: options.bobRoundWins,
    matchPoints: options.bobMatchPoints,
  });
  state.result = options.result ?? null;
  return state;
}

export function makeGolfRaceResult(): GolfRaceResultState {
  const result = new GolfRaceResultState();
  result.winnerSessionIds.push("host-session");
  const alice = new GolfRaceLeaderboardEntryState();
  alice.sessionId = "host-session";
  alice.rank = 1;
  alice.finishOrder = 1;
  alice.primaryScore = 10;
  alice.roundWins = 2;
  alice.label = "Alice";
  result.leaderboard.push(alice);
  const bob = new GolfRaceLeaderboardEntryState();
  bob.sessionId = "bob-session";
  bob.rank = 2;
  bob.finishOrder = 2;
  bob.primaryScore = 5;
  bob.roundWins = 0;
  bob.label = "Bob";
  result.leaderboard.push(bob);
  return result;
}

/** A fake connection whose room records sent messages for assertions. */
export function makeRoomConnection(state: GolfRaceState) {
  const sent: Array<{ type: string; payload: unknown }> = [];
  const room = {
    state,
    sessionId: "host-session",
    send: (type: string, payload?: unknown) => {
      sent.push({ type, payload });
    },
    onMessage: () => () => undefined,
    onStateChange: Object.assign(() => undefined, { remove: () => undefined }),
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
