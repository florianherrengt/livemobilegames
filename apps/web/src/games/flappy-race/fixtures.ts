import type { Client, Room } from "@colyseus/sdk";
import {
  FLAPPY_RACE_CONSTANTS,
  FLAPPY_RACE_GAME_ID,
  FlappyRaceLeaderboardEntryState,
  type FlappyRacePhase,
  FlappyRacePlayerState,
  FlappyRaceResultState,
  FlappyRaceState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

function addOpenings(state: FlappyRaceState, count = 12): void {
  for (let index = 0; index < count; index++) {
    state.obstacleOpenings.push(
      index % 2 === 0 ? FLAPPY_RACE_CONSTANTS.WORLD_HEIGHT - FLAPPY_RACE_CONSTANTS.GAP_SIZE : 0,
    );
  }
}

function addPlayer(
  state: FlappyRaceState,
  sessionId: string,
  name: string,
  joinedOrder: number,
  color: string,
  options: {
    roundActive?: boolean;
    eliminated?: boolean;
    matchRemoved?: boolean;
    birdY?: number;
    roundWins?: number;
    clearedObstacleCount?: number;
    connectionStatus?: "connected" | "reconnecting" | "disconnected";
  } = {},
): void {
  const player = new FlappyRacePlayerState();
  player.name = name;
  player.connectionStatus = options.connectionStatus ?? "connected";
  player.joinedOrder = joinedOrder;
  player.color = color;
  player.roundWins = options.roundWins ?? 0;
  player.clearedObstacleCount = options.clearedObstacleCount ?? 0;
  player.roundActive = options.roundActive ?? false;
  player.eliminated = options.eliminated ?? false;
  player.matchRemoved = options.matchRemoved ?? false;
  player.birdY = options.birdY ?? FLAPPY_RACE_CONSTANTS.BIRD_START_Y;
  player.birdVy = 0;
  state.players.set(sessionId, player);
}

/** Deterministic Flappy Race state for Storybook and component tests. */
export function makeFlappyRaceState(
  phase: FlappyRacePhase,
  options: {
    roundNumber?: number | undefined;
    totalRounds?: number | undefined;
    hostSessionId?: string | undefined;
    aliceRoundWins?: number | undefined;
    bobRoundWins?: number | undefined;
    aliceActive?: boolean | undefined;
    bobActive?: boolean | undefined;
    aliceReconnecting?: boolean | undefined;
    result?: FlappyRaceResultState | null | undefined;
  } = {},
): FlappyRaceState {
  const state = new FlappyRaceState();
  state.roomCode = "ABC234";
  state.gameId = FLAPPY_RACE_GAME_ID;
  state.phase = phase;
  state.hostSessionId = options.hostSessionId ?? "host-session";
  state.roundNumber = options.roundNumber ?? (phase === "lobby" ? 0 : 1);
  state.totalRounds = options.totalRounds ?? 5;
  if (phase === "countdown") {
    state.countdownEndsAt = Date.now() + 2_000;
  }
  if (phase === "round-result") {
    state.resultsEndsAt = Date.now() + 1_000;
  }
  if (phase === "countdown" || phase === "running" || phase === "round-result") {
    state.courseSpeed = FLAPPY_RACE_CONSTANTS.COURSE_SPEED;
    addOpenings(state);
  }

  addPlayer(state, "host-session", "Alice", 0, "#0072B2", {
    roundActive: options.aliceActive ?? (phase === "countdown" || phase === "running"),
    roundWins: options.aliceRoundWins ?? 0,
    birdY: phase === "running" ? 500 : FLAPPY_RACE_CONSTANTS.BIRD_START_Y,
    connectionStatus: options.aliceReconnecting ? "reconnecting" : "connected",
  });
  addPlayer(state, "bob-session", "Bob", 1, "#E69F00", {
    roundActive: options.bobActive ?? (phase === "countdown" || phase === "running"),
    roundWins: options.bobRoundWins ?? 0,
    birdY: phase === "running" ? 520 : FLAPPY_RACE_CONSTANTS.BIRD_START_Y,
  });

  if (phase === "round-result") {
    state.roundWinnerSessionIds.push("host-session");
  }
  state.result = options.result ?? null;
  return state;
}

export function makeFlappyRaceResult(options: { tie?: boolean } = {}): FlappyRaceResultState {
  const result = new FlappyRaceResultState();
  result.winnerSessionIds.push("host-session");
  if (options.tie) {
    result.winnerSessionIds.push("bob-session");
  }
  const alice = new FlappyRaceLeaderboardEntryState();
  alice.sessionId = "host-session";
  alice.rank = 1;
  alice.primaryScore = 5;
  alice.label = "Alice";
  result.leaderboard.push(alice);
  const bob = new FlappyRaceLeaderboardEntryState();
  bob.sessionId = "bob-session";
  bob.rank = options.tie ? 1 : 2;
  bob.primaryScore = options.tie ? 5 : 4;
  bob.label = "Bob";
  result.leaderboard.push(bob);
  return result;
}

/** A fake connection whose room records sent messages for assertions. */
export function makeRoomConnection(state: FlappyRaceState) {
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
