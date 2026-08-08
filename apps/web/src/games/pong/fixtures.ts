import type { Client, Room } from "@colyseus/sdk";
import {
  PONG_CONSTANTS,
  PONG_GAME_ID,
  PongBallState,
  PongLeaderboardEntryState,
  type PongPhase,
  PongPlayerState,
  PongResultState,
  PongState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

const TWO_PLAYER_OPENING_WIDTH = PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.TWO_PLAYER_GOAL_RATIO;
const TWO_PLAYER_START = PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.TWO_PLAYER_SIDE_RATIO;

function addPlayer(
  state: PongState,
  sessionId: string,
  name: string,
  joinedOrder: number,
  worldEdge: "top" | "right" | "bottom" | "left",
  options: {
    color?: string;
    score?: number;
    paddleCenter?: number;
    connectionStatus?: "connected" | "reconnecting";
    openingWidth?: number;
    openingStart?: number;
  } = {},
): void {
  const player = new PongPlayerState();
  player.name = name;
  player.connectionStatus = options.connectionStatus ?? "connected";
  player.joinedOrder = joinedOrder;
  player.color = options.color ?? (joinedOrder % 2 === 0 ? "#0072B2" : "#E69F00");
  player.worldEdge = worldEdge;
  player.slotIndex = 0;
  const openingWidth = options.openingWidth ?? TWO_PLAYER_OPENING_WIDTH;
  const openingStart = options.openingStart ?? TWO_PLAYER_START;
  player.openingStart = openingStart;
  player.openingEnd = openingStart + openingWidth;
  player.paddleLength = openingWidth * PONG_CONSTANTS.PADDLE_TO_GOAL_RATIO;
  player.paddleMin = openingStart + player.paddleLength / 2;
  player.paddleMax = openingStart + openingWidth - player.paddleLength / 2;
  player.paddleCenter = options.paddleCenter ?? (player.paddleMin + player.paddleMax) / 2;
  player.score = options.score ?? 0;
  state.players.set(sessionId, player);
}

function addBall(
  state: PongState,
  id: string,
  options: {
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    ownerSessionId?: string;
    warning?: boolean;
  } = {},
): void {
  const ball = new PongBallState();
  ball.id = id;
  ball.x = options.x ?? PONG_CONSTANTS.WORLD_SIZE / 2;
  ball.y = options.y ?? PONG_CONSTANTS.WORLD_SIZE / 2;
  ball.vx = options.vx ?? 0;
  ball.vy = options.vy ?? 0;
  ball.ownerSessionId = options.ownerSessionId ?? "";
  ball.spawnState = options.warning === true ? "warning" : "moving";
  ball.spawnsAt = options.warning === true ? Date.now() + 500 : 0;
  state.balls.set(id, ball);
}

/** Deterministic Pong state for Storybook and component tests. */
export function makePongState(
  phase: PongPhase,
  options: {
    hostSessionId?: string;
    aliceScore?: number;
    bobScore?: number;
    alicePaddleCenter?: number;
    aliceReconnecting?: boolean;
    result?: PongResultState | null;
    playerCount?: 2 | 4;
    ballCount?: number;
    lastGoalScorerSessionId?: string;
    lastGoalDefenderSessionId?: string;
    lastGoalAt?: number;
  } = {},
): PongState {
  const state = new PongState();
  state.roomCode = "ABC234";
  state.gameId = PONG_GAME_ID;
  state.phase = phase;
  state.hostSessionId = options.hostSessionId ?? "host-session";
  if (phase === "countdown") {
    state.countdownEndsAt = Date.now() + 2_000;
  }
  if (phase === "countdown" || phase === "running" || phase === "finished") {
    state.ballSpeed = PONG_CONSTANTS.BALL_SPEED;
    state.paddleSpeed = 300;
    state.desiredBallCount = 1;
  }
  if (phase === "running" || phase === "finished") {
    state.matchElapsedMs = 5_000;
  }

  addPlayer(state, "host-session", "Alice", 0, "bottom", {
    color: "#0072B2",
    score: options.aliceScore ?? 0,
    ...(options.alicePaddleCenter !== undefined ? { paddleCenter: options.alicePaddleCenter } : {}),
    connectionStatus: options.aliceReconnecting ? "reconnecting" : "connected",
  });
  addPlayer(state, "bob-session", "Bob", 1, "top", {
    color: "#E69F00",
    score: options.bobScore ?? 0,
  });

  if (options.playerCount === 4) {
    const width = PONG_CONSTANTS.WORLD_SIZE * PONG_CONSTANTS.GOAL_RATIO_MULTI;
    const start = (PONG_CONSTANTS.WORLD_SIZE - width) / 2;
    addPlayer(state, "carol-session", "Carol", 2, "right", {
      color: "#009E73",
      openingWidth: width,
      openingStart: start,
    });
    addPlayer(state, "dave-session", "Dave", 3, "left", {
      color: "#CC79A7",
      openingWidth: width,
      openingStart: start,
    });
  }

  const ballCount = options.ballCount ?? 1;
  for (let index = 0; index < ballCount; index++) {
    addBall(state, `ball-${index + 1}`, {
      warning: phase === "countdown",
      vx: index % 2 === 0 ? 260 : -260,
      vy: 260,
    });
  }
  state.lastGoalScorerSessionId = options.lastGoalScorerSessionId ?? "";
  state.lastGoalDefenderSessionId = options.lastGoalDefenderSessionId ?? "";
  state.lastGoalAt = options.lastGoalAt ?? 0;
  state.result = options.result ?? null;
  return state;
}

export function makePongResult(options: { bobScore?: number } = {}): PongResultState {
  const result = new PongResultState();
  result.winnerSessionIds.push("host-session");
  const alice = new PongLeaderboardEntryState();
  alice.sessionId = "host-session";
  alice.rank = 1;
  alice.score = 10;
  alice.label = "Alice";
  result.leaderboard.push(alice);
  const bob = new PongLeaderboardEntryState();
  bob.sessionId = "bob-session";
  bob.rank = 2;
  bob.score = options.bobScore ?? 7;
  bob.label = "Bob";
  result.leaderboard.push(bob);
  return result;
}

/** A fake connection whose room records sent messages for assertions. */
export function makeRoomConnection(state: PongState) {
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
