import type { Client, Room } from "@colyseus/sdk";
import {
  LIVE_DRAWING_GUESSING_GAME_ID,
  type LiveDrawingGuessingPhase,
  LiveDrawingGuessingState,
  LiveDrawingLeaderboardEntryState,
  LiveDrawingPlayerState,
  LiveDrawingResultState,
  LiveDrawingStrokeState,
  LiveDrawingTurnResultState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

function addPlayer(
  state: LiveDrawingGuessingState,
  playerId: string,
  sessionId: string,
  name: string,
  joinedOrder: number,
  options: {
    isHost?: boolean;
    isSpectator?: boolean;
    score?: number;
    connectionStatus?: "connected" | "reconnecting" | "disconnected";
  } = {},
): void {
  const player = new LiveDrawingPlayerState();
  player.playerId = playerId;
  player.sessionId = sessionId;
  player.name = name;
  player.isHost = options.isHost ?? false;
  player.isSpectator = options.isSpectator ?? false;
  player.score = options.score ?? 0;
  player.joinedOrder = joinedOrder;
  player.connectionStatus = options.connectionStatus ?? "connected";
  state.players.set(playerId, player);
}

function addStroke(state: LiveDrawingGuessingState, color: string, points: number[]): void {
  const stroke = new LiveDrawingStrokeState();
  stroke.strokeId = `stroke-${state.strokes.length}`;
  stroke.color = color;
  stroke.complete = true;
  stroke.points.push(...points);
  state.strokes.push(stroke);
}

function addTurnResult(
  state: LiveDrawingGuessingState,
  outcome: "solved" | "timeout" | "skipped" | "no-guessers",
): void {
  const result = new LiveDrawingTurnResultState();
  result.word = "PENGUIN";
  result.category = "Animal";
  result.outcome = outcome;
  result.drawerPlayerId = "alice";
  result.winnerPlayerId = outcome === "solved" ? "bob" : "";
  state.lastResult = result;
}

function addResult(state: LiveDrawingGuessingState, options: { tie?: boolean } = {}): void {
  const result = new LiveDrawingResultState();
  result.winnerPlayerIds.push("alice");
  if (options.tie) {
    result.winnerPlayerIds.push("bob");
  }
  const alice = new LiveDrawingLeaderboardEntryState();
  alice.playerId = "alice";
  alice.rank = 1;
  alice.score = 6;
  alice.label = "Alice";
  result.leaderboard.push(alice);
  const bob = new LiveDrawingLeaderboardEntryState();
  bob.playerId = "bob";
  bob.rank = options.tie ? 1 : 2;
  bob.score = options.tie ? 6 : 5;
  bob.label = "Bob";
  result.leaderboard.push(bob);
  state.result = result;
}

function setScore(state: LiveDrawingGuessingState, playerId: string, score: number): void {
  const player = state.players.get(playerId);
  if (player !== undefined) {
    player.score = score;
  }
}

/** Deterministic Live Drawing and Guessing state for Storybook and tests. */
export function makeLiveDrawingGuessingState(
  phase: LiveDrawingGuessingPhase,
  options: {
    drawerPlayerId?: string | undefined;
    aliceScore?: number | undefined;
    bobScore?: number | undefined;
    bobSpectator?: boolean | undefined;
    turnNumber?: number | undefined;
    roundNumber?: number | undefined;
    result?: "solved" | "timeout" | "skipped" | "no-guessers" | undefined;
    tie?: boolean | undefined;
  } = {},
): LiveDrawingGuessingState {
  const state = new LiveDrawingGuessingState();
  state.roomCode = "ABC234";
  state.gameId = LIVE_DRAWING_GUESSING_GAME_ID;
  state.hostSessionId = "alice-session";
  state.phase = phase;
  state.totalRounds = 3;
  state.totalTurns = 6;
  state.roundNumber = options.roundNumber ?? (phase === "lobby" ? 0 : 1);
  state.turnNumber = options.turnNumber ?? (phase === "lobby" ? 0 : 1);
  state.drawerPlayerId = options.drawerPlayerId ?? "alice";

  addPlayer(state, "alice", "alice-session", "Alice", 0, {
    isHost: true,
    score: options.aliceScore ?? 0,
  });
  addPlayer(state, "bob", "bob-session", "Bob", 1, {
    score: options.bobScore ?? 0,
    isSpectator: options.bobSpectator ?? false,
  });

  if (phase === "preparing") {
    state.prepareEndsAt = Date.now() + 2_000;
  }
  if (phase === "drawing") {
    state.wordCategory = "Animal";
    state.letterPattern.push("_", "_", "_", "_", "_", "_", "_");
    state.drawingEndsAt = Date.now() + 30_000;
    addStroke(state, "#000000", [100, 100, 200, 150, 300, 260]);
    addStroke(state, "#e02424", [350, 300, 420, 380, 500, 420]);
  }
  if (phase === "result") {
    state.wordCategory = "Animal";
    state.letterPattern.push("P", "_", "N", "G", "U", "I", "N");
    state.resultEndsAt = Date.now() + 1_000;
    addStroke(state, "#000000", [100, 100, 200, 150, 300, 260]);
    addTurnResult(state, options.result ?? "solved");
    if (
      options.result !== "timeout" &&
      options.result !== "skipped" &&
      options.result !== "no-guessers"
    ) {
      setScore(state, "alice", options.aliceScore ?? 1);
      setScore(state, "bob", options.bobScore ?? 1);
    }
  }
  if (phase === "round-summary") {
    state.roundSummaryEndsAt = Date.now() + 1_000;
    setScore(state, "alice", options.aliceScore ?? 2);
    setScore(state, "bob", options.bobScore ?? 1);
  }
  if (phase === "finished") {
    addResult(state, { tie: options.tie ?? false });
    setScore(state, "alice", 6);
    setScore(state, "bob", options.tie === true ? 6 : 5);
  }
  return state;
}

/** A fake connection whose room records sent messages and can emit events. */
export function makeRoomConnection(
  state: LiveDrawingGuessingState,
  selfSessionId = "alice-session",
) {
  const sent: Array<{ type: string; payload: unknown }> = [];
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const wildcardHandlers: Array<(type: string | number, payload: unknown) => void> = [];
  const room = {
    state,
    sessionId: selfSessionId,
    send: (type: string, payload?: unknown) => {
      sent.push({ type, payload });
    },
    onMessage: (type: string, callback: (payload: unknown) => void) => {
      if (type === "*") {
        wildcardHandlers.push(callback as (type: string | number, payload: unknown) => void);
        return () => undefined;
      }
      const list = handlers.get(type) ?? [];
      list.push(callback);
      handlers.set(type, list);
      return () => undefined;
    },
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
  return {
    connection,
    sent,
    emit(type: string, payload: unknown): void {
      for (const handler of handlers.get(type) ?? []) {
        handler(payload);
      }
      for (const handler of wildcardHandlers) {
        handler(type, payload);
      }
    },
  };
}
