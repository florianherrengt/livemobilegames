import type { Client, Room } from "@colyseus/sdk";
import {
  MEMORY_PATH_CONSTANTS,
  MEMORY_PATH_GAME_ID,
  MemoryPathLandmarkState,
  MemoryPathLeaderboardEntryState,
  MemoryPathMatchResultState,
  type MemoryPathPhase,
  MemoryPathPlayerState,
  MemoryPathPointState,
  MemoryPathRoundResultState,
  MemoryPathState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

const ROUTE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [195, 700],
  [110, 700],
  [110, 540],
  [300, 540],
  [300, 350],
  [150, 350],
  [150, 190],
  [195, 140],
];

function addRoute(state: MemoryPathState): void {
  for (const [x, y] of ROUTE_POINTS) {
    const point = new MemoryPathPointState();
    point.x = x;
    point.y = y;
    state.routePoints.push(point);
  }
}

function addLandmarks(state: MemoryPathState): void {
  const landmarks: Array<
    [string, "circle" | "square" | "triangle", number, number, number, string]
  > = [
    ["circle-tl", "circle", 32, 180, 14, "#e63946"],
    ["square-tr", "square", 358, 220, 16, "#457b9d"],
    ["triangle-ml", "triangle", 32, 360, 16, "#2a9d8f"],
    ["circle-mr", "circle", 358, 420, 14, "#f4a261"],
    ["square-bl", "square", 32, 540, 16, "#9b5de5"],
    ["triangle-br", "triangle", 358, 600, 16, "#f15bb5"],
    ["circle-bl", "circle", 32, 680, 14, "#00bbf9"],
    ["square-br", "square", 358, 700, 16, "#fee440"],
  ];
  for (const [id, shape, x, y, size, color] of landmarks) {
    const landmark = new MemoryPathLandmarkState();
    landmark.id = id;
    landmark.shape = shape;
    landmark.x = x;
    landmark.y = y;
    landmark.size = size;
    landmark.color = color;
    state.landmarks.push(landmark);
  }
}

function addPlayer(
  state: MemoryPathState,
  sessionId: string,
  name: string,
  joinedOrder: number,
  color: string,
  options: {
    participating?: boolean;
    roundActive?: boolean;
    finished?: boolean;
    falling?: boolean;
    respawnEndsAt?: number;
    positionX?: number;
    positionY?: number;
    progress?: number;
    maxProgress?: number;
    falls?: number;
    roundWins?: number;
    connectionStatus?: "connected" | "reconnecting" | "disconnected";
  } = {},
): void {
  const player = new MemoryPathPlayerState();
  player.name = name;
  player.connectionStatus = options.connectionStatus ?? "connected";
  player.joinedOrder = joinedOrder;
  player.color = color;
  player.roundWins = options.roundWins ?? 0;
  player.participating = options.participating ?? true;
  player.roundActive = options.roundActive ?? true;
  player.finished = options.finished ?? false;
  player.falling = options.falling ?? false;
  player.respawnEndsAt = options.respawnEndsAt ?? 0;
  player.positionX = options.positionX ?? MEMORY_PATH_CONSTANTS.START_X;
  player.positionY = options.positionY ?? MEMORY_PATH_CONSTANTS.START_Y;
  player.progress = options.progress ?? 0;
  player.maxProgress = options.maxProgress ?? 0;
  player.falls = options.falls ?? 0;
  state.players.set(sessionId, player);
}

/** Deterministic Memory Path state for Storybook and component tests. */
export function makeMemoryPathState(
  phase: MemoryPathPhase,
  options: {
    roundNumber?: number;
    totalRounds?: number;
    suddenDeath?: boolean;
    hostSessionId?: string;
    pathVisible?: boolean;
    opponentsVisible?: boolean;
    aliceRoundWins?: number;
    bobRoundWins?: number;
    aliceActive?: boolean;
    bobActive?: boolean;
    aliceFalling?: boolean;
    aliceReconnecting?: boolean;
    aliceProgress?: number;
    bobProgress?: number;
    roundResult?: MemoryPathRoundResultState | null;
    matchResult?: MemoryPathMatchResultState | null;
  } = {},
): MemoryPathState {
  const state = new MemoryPathState();
  state.roomCode = "ABC234";
  state.gameId = MEMORY_PATH_GAME_ID;
  state.hostSessionId = options.hostSessionId ?? "host-session";
  state.phase = phase;
  state.roundNumber = options.roundNumber ?? (phase === "lobby" ? 0 : 1);
  state.totalRounds = options.totalRounds ?? (options.suddenDeath ? 4 : 3);
  state.suddenDeath = options.suddenDeath ?? false;
  state.pathWidth =
    options.roundNumber === 1
      ? MEMORY_PATH_CONSTANTS.EASY_PATH_WIDTH
      : options.roundNumber === 2
        ? MEMORY_PATH_CONSTANTS.MEDIUM_PATH_WIDTH
        : MEMORY_PATH_CONSTANTS.HARD_PATH_WIDTH;
  state.movementSpeed = MEMORY_PATH_CONSTANTS.MOVEMENT_SPEED;
  state.startX = MEMORY_PATH_CONSTANTS.START_X;
  state.startY = MEMORY_PATH_CONSTANTS.START_Y;
  state.finishX = MEMORY_PATH_CONSTANTS.FINISH_X;
  state.finishY = MEMORY_PATH_CONSTANTS.FINISH_Y;
  state.finishRadius = MEMORY_PATH_CONSTANTS.FINISH_RADIUS;
  state.startRadius = MEMORY_PATH_CONSTANTS.START_RADIUS;

  if (phase === "preparing") {
    state.preparingEndsAt = Date.now() + 1_000;
  }
  if (phase === "preview") {
    state.previewEndsAt = Date.now() + 3_000;
  }
  if (phase === "racing") {
    state.raceEndsAt = Date.now() + 10_000;
  }
  if (phase === "round-result") {
    state.resultsEndsAt = Date.now() + 1_000;
  }
  state.pathVisible = options.pathVisible ?? (phase === "preview" || phase === "round-result");
  state.opponentsVisible =
    options.opponentsVisible ?? (phase === "preview" || phase === "round-result");

  addRoute(state);
  addLandmarks(state);

  const inRound =
    phase === "preparing" || phase === "preview" || phase === "racing" || phase === "round-result";
  addPlayer(state, "host-session", "Alice", 0, "#0072B2", {
    participating: true,
    roundActive: options.aliceActive ?? inRound,
    roundWins: options.aliceRoundWins ?? 0,
    falling: options.aliceFalling ?? false,
    progress: options.aliceProgress ?? (inRound ? 0 : 0),
    maxProgress: options.aliceProgress ?? 0,
    positionY:
      options.aliceProgress !== undefined
        ? MEMORY_PATH_CONSTANTS.START_Y - options.aliceProgress * 300
        : MEMORY_PATH_CONSTANTS.START_Y,
    connectionStatus: options.aliceReconnecting ? "reconnecting" : "connected",
  });
  addPlayer(state, "bob-session", "Bob", 1, "#E69F00", {
    participating: !options.suddenDeath || phase === "match-result",
    roundActive: options.bobActive ?? inRound,
    roundWins: options.bobRoundWins ?? 0,
    progress: options.bobProgress ?? 0,
    maxProgress: options.bobProgress ?? 0,
    positionY:
      options.bobProgress !== undefined
        ? MEMORY_PATH_CONSTANTS.START_Y - options.bobProgress * 300
        : MEMORY_PATH_CONSTANTS.START_Y,
  });

  state.roundResult = options.roundResult ?? null;
  state.matchResult = options.matchResult ?? null;
  return state;
}

export function makeMemoryPathRoundResult(
  options: {
    roundNumber?: number;
    suddenDeath?: boolean;
    reason?: "finish" | "timeout";
    winnerSessionIds?: string[];
    winnerLabel?: string;
    winnerProgress?: number;
  } = {},
): MemoryPathRoundResultState {
  const result = new MemoryPathRoundResultState();
  result.roundNumber = options.roundNumber ?? 1;
  result.suddenDeath = options.suddenDeath ?? false;
  result.reason = options.reason ?? "finish";
  result.winnerProgress = options.winnerProgress ?? 100;
  result.winnerLabel = options.winnerLabel ?? "Alice";
  for (const sessionId of options.winnerSessionIds ?? ["host-session"]) {
    result.winnerSessionIds.push(sessionId);
  }
  return result;
}

export function makeMemoryPathMatchResult(
  options: { suddenDeathUsed?: boolean; aliceWins?: number; bobWins?: number } = {},
): MemoryPathMatchResultState {
  const result = new MemoryPathMatchResultState();
  result.suddenDeathUsed = options.suddenDeathUsed ?? false;
  result.winnerSessionIds.push("host-session");
  result.roundResults.push(makeMemoryPathRoundResult({ roundNumber: 1 }));
  result.roundResults.push(makeMemoryPathRoundResult({ roundNumber: 2 }));
  result.roundResults.push(makeMemoryPathRoundResult({ roundNumber: 3 }));
  if (options.suddenDeathUsed) {
    result.roundResults.push(makeMemoryPathRoundResult({ roundNumber: 4, suddenDeath: true }));
  }
  const alice = new MemoryPathLeaderboardEntryState();
  alice.sessionId = "host-session";
  alice.rank = 1;
  alice.roundWins = options.aliceWins ?? 3;
  alice.label = "Alice";
  result.leaderboard.push(alice);
  const bob = new MemoryPathLeaderboardEntryState();
  bob.sessionId = "bob-session";
  bob.rank = 2;
  bob.roundWins = options.bobWins ?? 0;
  bob.label = "Bob";
  result.leaderboard.push(bob);
  return result;
}

/** A fake connection whose room records sent messages for assertions. */
export function makeRoomConnection(state: MemoryPathState) {
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
