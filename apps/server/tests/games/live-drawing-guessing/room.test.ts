import { randomBytes } from "node:crypto";

import {
  type ISeatReservation,
  LiveDrawingGuessingState,
  LobbyRoomState,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { matchMaker } from "colyseus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameRegistry } from "../../../src/games/game-registry.js";
import { LIVE_DRAWING_GUESSING_SERVER_CONSTANTS } from "../../../src/games/live-drawing-guessing/constants.js";
import {
  createLiveDrawingGuessingGameDefinition,
  LIVE_DRAWING_GUESSING_ROOM_TYPE,
} from "../../../src/games/live-drawing-guessing/definition.js";
import { createSeededIntRng, shuffle } from "../../../src/games/live-drawing-guessing/rng.js";
import { WORD_POOL } from "../../../src/games/live-drawing-guessing/words.js";
import {
  cookieValue,
  createTestConfig,
  createTestPlatform,
  stopTestPlatform,
  type TestPlatform,
  waitFor,
} from "../../helpers/test-platform.js";

const E2E_CONFIG = { E2E_TEST_MODE: "true" } as const;
const ROOM_CREATION_TOKEN = randomBytes(32).toString("hex");

type MessageRoom = {
  onMessage: (
    type: "*",
    callback: (messageType: string | number, payload: unknown) => void,
  ) => () => void;
};

type SendRoom = {
  send: (type: string, message?: unknown) => void;
  onMessage: (
    type: "*",
    callback: (messageType: string | number, payload: unknown) => void,
  ) => () => void;
  state: LiveDrawingGuessingState;
  sessionId: string;
  connection: { close: () => void };
  reconnectionToken?: string;
  leave: () => Promise<void>;
};

async function consumeLobby(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LobbyRoomState,
  );
}

async function consumeGame(test: TestPlatform, reservation: unknown): Promise<SendRoom> {
  return (await test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LiveDrawingGuessingState,
  )) as unknown as SendRoom;
}

async function createRoomHttp(test: TestPlatform, name: string) {
  const url = `http://127.0.0.1:${test.testServer.sdk.settings.port}/api/rooms`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ playerName: name }),
  });
  const body = (await response.json()) as { room: { code: string }; reservation: unknown };
  return { body, cookie: cookieValue(response.headers.get("set-cookie")) };
}

async function joinRoomHttp(test: TestPlatform, code: string, name: string) {
  const url = `http://127.0.0.1:${test.testServer.sdk.settings.port}/api/rooms/${code}/join`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ playerName: name }),
  });
  const body = (await response.json()) as {
    room?: { code: string };
    reservation?: unknown;
    error?: { code: string };
  };
  return { body, response };
}

function waitForTransition(room: MessageRoom): Promise<RoomTransition> {
  return new Promise((resolve) => {
    const off = room.onMessage("*", (type, payload) => {
      if (type === ROOM_MESSAGE_TYPES.transition) {
        off();
        resolve(payload as RoomTransition);
      }
    });
  });
}

function waitForRoomError(room: MessageRoom, code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${code}`)), 5_000);
    const off = room.onMessage("*", (type, payload) => {
      if (type === ROOM_MESSAGE_TYPES.error) {
        const error = payload as { code: string; message: string };
        if (error.code === code) {
          clearTimeout(timer);
          off();
          resolve(error.message);
        }
      }
    });
  });
}

function waitForGuessFeedback(room: MessageRoom, kind: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for guess feedback ${kind}`)),
      5_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === "guess:feedback") {
        const feedback = payload as { kind: string };
        if (feedback.kind === kind) {
          clearTimeout(timer);
          off();
          resolve();
        }
      }
    });
  });
}

function waitForMessage(room: MessageRoom, type: string, timeoutMs = 5_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
    const off = room.onMessage("*", (messageType, payload) => {
      if (messageType === type) {
        clearTimeout(timer);
        off();
        resolve(payload);
      }
    });
  });
}

/**
 * E2E mode shuffles the word pool with a fixed seed and draws from the end.
 * The word for turn N is therefore deterministic, so real-socket tests can
 * submit correct guesses without depending on private-briefing arrival order.
 */
function e2eWordForTurn(turnNumber: number): string {
  const deck = shuffle(
    [...WORD_POOL],
    createSeededIntRng(LIVE_DRAWING_GUESSING_SERVER_CONSTANTS.E2E_WORD_SEED),
  );
  const entry = deck[deck.length - turnNumber];
  if (entry === undefined) {
    throw new Error(`No e2e word for turn ${turnNumber}`);
  }
  return entry.word;
}

function playerIds(count: number): Array<{
  playerId: string;
  playerName: string;
  isHost: boolean;
  joinedOrder: number;
}> {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    playerName: `Player ${index}`,
    isHost: index === 0,
    joinedOrder: index,
  }));
}

function authContext() {
  return { token: ROOM_CREATION_TOKEN, headers: new Headers(), ip: "internal" };
}

async function createDirectRoom(count = 2, options: { e2eTurnDurationMs?: number } = {}) {
  const players = playerIds(count);
  const room = await matchMaker.create(
    LIVE_DRAWING_GUESSING_ROOM_TYPE,
    {
      roomCode: "ABCDEF",
      players,
      e2eMode: true,
      transitionTimeoutMs: 5_000,
      roomCreationToken: ROOM_CREATION_TOKEN,
      ...(options.e2eTurnDurationMs === undefined
        ? {}
        : { e2eTurnDurationMs: options.e2eTurnDurationMs }),
    },
    authContext(),
  );
  const reservations = [];
  for (const player of players) {
    reservations.push(
      await matchMaker.joinById(
        room.roomId,
        { playerId: player.playerId, playerName: player.playerName },
        authContext(),
      ),
    );
  }
  return { room, players, reservations };
}

function stroke(room: SendRoom, strokeId: string, points: number[], complete = false): void {
  room.send("game:stroke", {
    type: "stroke",
    strokeId,
    color: "#000000",
    points,
    complete,
  });
}

function guess(room: SendRoom, text: string): void {
  room.send("game:guess", { type: "guess", text });
}

function undo(room: SendRoom): void {
  room.send("game:undo", { type: "undo" });
}

async function waitForPhase(room: SendRoom, phase: string, timeoutMs = 15_000): Promise<void> {
  await waitFor(() => room.state.phase === phase, timeoutMs);
}

async function waitForTurn(room: SendRoom, turnNumber: number, timeoutMs = 15_000): Promise<void> {
  await waitFor(() => room.state.turnNumber === turnNumber, timeoutMs);
}

function participantRooms(rooms: readonly SendRoom[]): SendRoom[] {
  return rooms.filter(
    (room) =>
      [...room.state.players.values()].find((player) => player.sessionId === room.sessionId)
        ?.isSpectator !== true,
  );
}

async function waitForPlayers(room: SendRoom, count: number, timeoutMs = 10_000): Promise<void> {
  await waitFor(() => room.state.players.size >= count, timeoutMs);
}

function selfPlayer(room: SendRoom) {
  const player = [...room.state.players.values()].find(
    (entry) => entry.sessionId === room.sessionId,
  );
  if (player === undefined) {
    throw new Error("Player not found in state");
  }
  return player;
}

/**
 * Play one turn to a correct answer: wait for the drawing phase, take the
 * word from the drawer's private briefing, have one connected guesser submit
 * it, and wait for the solved result.
 */
async function playSolvedTurn(rooms: readonly SendRoom[], turnNumber: number): Promise<string> {
  const alice = rooms[0];
  if (!alice) {
    throw new Error("No rooms");
  }
  await waitForTurn(alice, turnNumber);
  await waitForPhase(alice, "drawing", 10_000);
  const drawerId = alice.state.drawerPlayerId;
  const word = e2eWordForTurn(turnNumber);
  const guesser = participantRooms(rooms).find((room) => selfPlayer(room).playerId !== drawerId);
  if (!guesser) {
    throw new Error("No guesser room");
  }
  guess(guesser, word);
  await waitFor(() => alice.state.phase === "result", 5_000);
  expect(alice.state.lastResult?.outcome).toBe("solved");
  expect(alice.state.lastResult?.word).toBe(word);
  expect(alice.state.lastResult?.winnerPlayerId).toBe(selfPlayer(guesser).playerId);
  await waitFor(
    () =>
      alice.state.turnNumber === turnNumber + 1 ||
      alice.state.phase === "finished" ||
      alice.state.phase === "round-summary",
    5_000,
  );
  return word;
}

describe("Live Drawing and Guessing room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createLiveDrawingGuessingGameDefinition(ROOM_CREATION_TOKEN)]),
      createTestConfig(E2E_CONFIG),
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs a complete two-player match from lobby to final results", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "live-drawing-guessing" });
    await waitFor(() => aliceLobby.state.gameId === "live-drawing-guessing");

    const aliceTransition = waitForTransition(aliceLobby);
    const bobTransition = waitForTransition(bobLobby);
    aliceLobby.send("start_game", {});
    const [alicePayload, bobPayload] = await Promise.all([aliceTransition, bobTransition]);
    const alice = await consumeGame(test, alicePayload.reservation);
    const bob = await consumeGame(test, bobPayload.reservation);

    await waitFor(() => alice.state.players.size === 2);
    await waitForPlayers(bob, 2);
    await waitForPhase(alice, "preparing", 10_000);
    expect(alice.state.roomCode).toBe(created.body.room.code);
    expect(alice.state.gameId).toBe("live-drawing-guessing");
    expect(alice.state.totalRounds).toBe(3);
    expect(alice.state.totalTurns).toBe(6);
    expect(alice.state.drawerPlayerId).not.toBe("");
    expect("word" in alice.state).toBe(false);
    expect(bob.state.phase).toBe("preparing");

    const seenWords = new Set<string>();
    for (let turn = 1; turn <= 6; turn += 1) {
      const word = await playSolvedTurn([alice, bob], turn);
      expect(seenWords.has(word)).toBe(false);
      seenWords.add(word);
    }
    expect(seenWords.size).toBe(6);
    await waitForPhase(alice, "finished", 10_000);
    await waitForPhase(bob, "finished", 10_000);

    const result = alice.state.result;
    if (result === null) {
      throw new Error("Expected a match result");
    }
    expect([...result.winnerPlayerIds].sort()).toEqual(
      [selfPlayer(alice).playerId, selfPlayer(bob).playerId].sort(),
    );
    expect(result.leaderboard).toHaveLength(2);
    for (const entry of result.leaderboard) {
      expect(entry.score).toBe(6);
      expect(entry.rank).toBe(1);
    }
    expect(alice.state.players.get(selfPlayer(alice).playerId)?.score).toBe(6);
    expect(alice.state.players.get(selfPlayer(bob).playerId)?.score).toBe(6);
    expect(bob.state.result).not.toBeNull();
    expect(alice.state.turnNumber).toBe(6);
  }, 60_000);

  it("awards only the first correct guess and keeps guesses private", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await Promise.all([waitForPlayers(alice, 3), waitForPlayers(bob, 3), waitForPlayers(carol, 3)]);
    await waitForPhase(alice, "drawing", 10_000);

    const word = e2eWordForTurn(1);
    const drawerId = alice.state.drawerPlayerId;
    const guessers = participantRooms([alice, bob, carol]).filter(
      (room) => selfPlayer(room).playerId !== drawerId,
    );
    const first = guessers[0];
    const second = guessers[1];
    if (!first || !second) {
      throw new Error("Expected two guesser rooms");
    }

    // Wrong guesses are private: only the submitting guesser hears feedback.
    const firstWrongFeedback = waitForGuessFeedback(first, "incorrect");
    let secondSawFeedback = false;
    second.onMessage("*", (type, _payload) => {
      if (type === "guess:feedback") {
        secondSawFeedback = true;
      }
    });
    guess(first, "totally wrong");
    await firstWrongFeedback;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(secondSawFeedback).toBe(false);

    // Reveals progressed before the solve and stopped at it.
    await waitFor(() => alice.state.letterPattern.some((char) => /[A-Za-z]/.test(char)), 5_000);
    const revealedBefore = alice.state.letterPattern.filter((char) => /[A-Za-z]/.test(char)).length;
    expect(revealedBefore).toBeGreaterThan(0);
    expect(revealedBefore).toBeLessThan(word.replace(/[^A-Za-z]/g, "").length);

    const secondIgnored = waitForGuessFeedback(second, "not-active");
    guess(first, word);
    await new Promise((resolve) => setTimeout(resolve, 50));
    guess(second, word);
    await secondIgnored;
    await waitFor(() => alice.state.phase === "result", 5_000);
    expect(alice.state.lastResult?.winnerPlayerId).toBe(selfPlayer(first).playerId);
    expect(alice.state.lastResult?.outcome).toBe("solved");
    expect(alice.state.players.get(selfPlayer(first).playerId)?.score).toBe(1);
    expect(alice.state.players.get(drawerId)?.score).toBe(1);
    expect(alice.state.players.get(selfPlayer(second).playerId)?.score).toBe(0);
    const revealedAfter = alice.state.letterPattern.filter((char) => /[A-Za-z]/.test(char)).length;
    expect(revealedAfter).toBe(revealedBefore);
  }, 30_000);

  it("rejects invalid, stale, duplicate, and out-of-phase inputs", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await Promise.all([waitForPlayers(alice, 2), waitForPlayers(bob, 2)]);
    await waitForPhase(alice, "drawing", 10_000);
    const drawerId = alice.state.drawerPlayerId;
    const drawer = participantRooms([alice, bob]).find(
      (room) => selfPlayer(room).playerId === drawerId,
    );
    const guesser = participantRooms([alice, bob]).find(
      (room) => selfPlayer(room).playerId !== drawerId,
    );
    if (!drawer || !guesser) {
      throw new Error("Expected drawer and guesser");
    }
    const word = e2eWordForTurn(1);

    const malformed = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:stroke", { command: { type: "erase" } });
    await malformed;

    const forged = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:stroke", {
      type: "stroke",
      strokeId: "s2",
      color: "#000000",
      points: [0, 0],
      playerId: "forged",
      score: 99,
      winner: true,
    });
    await forged;

    const notDrawer = waitForRoomError(guesser, "INVALID_GAME_COMMAND");
    stroke(guesser, "s3", [0, 0], true);
    await notDrawer;

    const drawerGuesses = waitForGuessFeedback(drawer, "not-guesser");
    guess(drawer, "anything");
    await drawerGuesses;

    const duplicateWrongOne = waitForGuessFeedback(guesser, "incorrect");
    guess(guesser, "nope");
    await duplicateWrongOne;
    const duplicateWrongTwo = waitForGuessFeedback(guesser, "incorrect");
    guess(guesser, "nope");
    await duplicateWrongTwo;

    undo(guesser);
    expect(alice.state.strokes.length).toBe(0);

    // Complete a stroke and undo it, then undo again with nothing left.
    stroke(drawer, "s4", [1, 2, 3, 4], true);
    await waitFor(() => alice.state.strokes.length === 1, 5_000);
    // Undo changes synchronize live to every client.
    await waitFor(() => bob.state.strokes.length === 1, 5_000);
    undo(drawer);
    await waitFor(() => alice.state.strokes.length === 0, 5_000);
    await waitFor(() => bob.state.strokes.length === 0, 5_000);
    undo(drawer);
    expect(alice.state.strokes.length).toBe(0);

    // End the turn with a correct guess, then verify stale and out-of-phase
    // messages are rejected without mutating state.
    guess(guesser, word);
    await waitFor(() => alice.state.phase === "result", 5_000);
    const lateStroke = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    stroke(drawer, "s5", [0, 0], true);
    await lateStroke;
    const lateGuess = waitForGuessFeedback(guesser, "not-active");
    guess(guesser, "late");
    await lateGuess;
  }, 30_000);

  it("accepts a correct guess before any letter reveal and stops all reveals", async () => {
    const { reservations } = await createDirectRoom(2, { e2eTurnDurationMs: 10_000 });
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await Promise.all([waitForPlayers(alice, 2), waitForPlayers(bob, 2)]);
    await waitForPhase(alice, "drawing", 10_000);

    expect([...alice.state.letterPattern].every((char) => char === "_" || char === " ")).toBe(true);
    const word = e2eWordForTurn(1);
    const drawerId = alice.state.drawerPlayerId;
    const guesser = participantRooms([alice, bob]).find(
      (room) => selfPlayer(room).playerId !== drawerId,
    );
    if (!guesser) {
      throw new Error("Expected a guesser room");
    }
    guess(guesser, word);

    await waitFor(() => alice.state.phase === "result", 5_000);
    expect(alice.state.lastResult?.outcome).toBe("solved");
    expect(alice.state.lastResult?.word).toBe(word);
    expect([...alice.state.letterPattern].every((char) => char === "_" || char === " ")).toBe(true);
    expect(alice.state.players.get(drawerId)?.score).toBe(1);
    expect(alice.state.players.get(selfPlayer(guesser).playerId)?.score).toBe(1);
    expect(bob.state.phase).toBe("result");
  }, 30_000);

  it("holds a drawer disconnect and continues the same turn on reconnect", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await Promise.all([waitForPlayers(alice, 2), waitForPlayers(bob, 2)]);
    await waitForPhase(alice, "drawing", 10_000);

    const drawerId = alice.state.drawerPlayerId;
    const drawer = participantRooms([alice, bob]).find(
      (room) => selfPlayer(room).playerId === drawerId,
    );
    const guesser = participantRooms([alice, bob]).find(
      (room) => selfPlayer(room).playerId !== drawerId,
    );
    if (!drawer || !guesser) {
      throw new Error("Expected drawer and guesser");
    }
    const word = e2eWordForTurn(1);
    const deadlineBefore = alice.state.drawingEndsAt;

    // Colyseus's SDK refuses automatic reconnection for rooms younger than
    // five seconds; E2E rooms are intentionally short-lived, so the test
    // lowers the client-side threshold to exercise the real token path.
    (drawer as unknown as { reconnection: { minUptime: number } }).reconnection.minUptime = 0;
    const rebriefingPromise = waitForMessage(drawer, "drawer:briefing");
    drawer.connection.close();
    // Give the server a moment to register the drop and start the hold.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(alice.state.phase).toBe("drawing");
    expect(alice.state.drawingEndsAt).toBeGreaterThanOrEqual(deadlineBefore);

    // The SDK automatically re-establishes the same room through the Colyseus
    // token flow; the room object and its listeners stay alive.
    await waitFor(
      () => drawer.state.phase === "drawing" && drawer.state.players.size === 2,
      10_000,
    );
    const rebriefing = (await rebriefingPromise) as {
      word: string;
      turnNumber: number;
    };
    expect(rebriefing.word).toBe(word);
    expect(rebriefing.turnNumber).toBe(1);
    expect(alice.state.phase).toBe("drawing");
    expect(alice.state.drawingEndsAt).toBeGreaterThan(deadlineBefore);

    guess(guesser, word);
    await waitFor(() => alice.state.phase === "result", 5_000);
    expect(alice.state.lastResult?.outcome).toBe("solved");
    expect(alice.state.lastResult?.winnerPlayerId).toBe(selfPlayer(guesser).playerId);
    expect(alice.state.players.get(drawerId)?.score).toBe(1);
    expect(alice.state.players.get(selfPlayer(guesser).playerId)?.score).toBe(1);
  }, 30_000);

  it("skips the turn with no points when the drawer does not return", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await Promise.all([waitForPlayers(alice, 3), waitForPlayers(bob, 3), waitForPlayers(carol, 3)]);
    await waitForPhase(alice, "drawing", 10_000);

    const drawerId = alice.state.drawerPlayerId;
    const drawer = [alice, bob, carol].find((room) => selfPlayer(room).playerId === drawerId);
    if (!drawer) {
      throw new Error("Drawer room not found");
    }
    const observer = [alice, bob, carol].find((room) => selfPlayer(room).playerId !== drawerId);
    if (!observer) {
      throw new Error("No observer room");
    }
    await drawer.leave();
    await waitFor(
      () => observer.state.phase === "result" && observer.state.lastResult?.outcome === "skipped",
      10_000,
    );
    expect(observer.state.lastResult?.drawerPlayerId).toBe(drawerId);
    expect(observer.state.players.get(drawerId)?.score).toBe(0);
    expect(observer.state.players.get(drawerId)?.connectionStatus).toBe("disconnected");
    await waitFor(
      () => observer.state.turnNumber === 2 && observer.state.phase === "preparing",
      10_000,
    );
    expect(observer.state.drawerPlayerId).not.toBe(drawerId);
  }, 30_000);

  it("skips the turn when the drawer disconnects during preparation", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await Promise.all([waitForPlayers(alice, 3), waitForPlayers(bob, 3), waitForPlayers(carol, 3)]);
    await waitForPhase(alice, "preparing", 10_000);

    const drawerId = alice.state.drawerPlayerId;
    const drawer = [alice, bob, carol].find((room) => selfPlayer(room).playerId === drawerId);
    const observer = [alice, bob, carol].find((room) => selfPlayer(room).playerId !== drawerId);
    if (!drawer || !observer) {
      throw new Error("Expected drawer and observer rooms");
    }
    await drawer.leave();
    await waitFor(
      () => observer.state.phase === "result" && observer.state.lastResult?.outcome === "skipped",
      10_000,
    );
    expect(observer.state.lastResult?.drawerPlayerId).toBe(drawerId);
    expect(observer.state.players.get(drawerId)?.score).toBe(0);
    await waitFor(
      () => observer.state.turnNumber === 2 && observer.state.phase === "preparing",
      10_000,
    );
    expect(observer.state.drawerPlayerId).not.toBe(drawerId);
  }, 30_000);

  it("lets a disconnected guesser reconnect and resume guessing", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await Promise.all([waitForPlayers(alice, 3), waitForPlayers(bob, 3), waitForPlayers(carol, 3)]);
    await waitForPhase(alice, "drawing", 10_000);

    const drawerId = alice.state.drawerPlayerId;
    const guessers = participantRooms([alice, bob, carol]).filter(
      (room) => selfPlayer(room).playerId !== drawerId,
    );
    const dropping = guessers[0];
    const remaining = guessers[1];
    if (!dropping || !remaining) {
      throw new Error("Expected two guesser rooms");
    }
    const word = e2eWordForTurn(1);

    (dropping as unknown as { reconnection: { minUptime: number } }).reconnection.minUptime = 0;
    dropping.connection.close();
    await waitFor(
      () =>
        [...alice.state.players.values()].find(
          (player) => player.playerId === selfPlayer(dropping).playerId,
        )?.connectionStatus === "reconnecting",
      5_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alice.state.phase).toBe("drawing");

    // The SDK auto-reconnects through the same room object; wait for it.
    await waitFor(
      () =>
        [...dropping.state.players.values()].find(
          (player) => player.playerId === selfPlayer(dropping).playerId,
        )?.connectionStatus === "connected",
      10_000,
    );
    await waitFor(
      () =>
        [...alice.state.players.values()].find(
          (player) => player.playerId === selfPlayer(dropping).playerId,
        )?.connectionStatus === "connected",
      5_000,
    );

    guess(dropping, word);
    await waitFor(() => alice.state.phase === "result", 5_000);
    expect(alice.state.lastResult?.winnerPlayerId).toBe(selfPlayer(dropping).playerId);
    expect(alice.state.players.get(selfPlayer(remaining).playerId)?.score).toBe(0);
  }, 30_000);

  it("ends a turn immediately when every guesser disconnects", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitForPhase(alice, "drawing", 10_000);
    const drawerId = alice.state.drawerPlayerId;
    const guesser = participantRooms([alice, bob]).find(
      (room) => selfPlayer(room).playerId !== drawerId,
    );
    if (!guesser) {
      throw new Error("Expected a guesser");
    }
    guesser.connection.close();
    await waitFor(
      () => alice.state.phase === "result" && alice.state.lastResult?.outcome === "no-guessers",
      10_000,
    );
    expect(alice.state.players.get(drawerId)?.score).toBe(0);
    expect(alice.state.players.get(selfPlayer(guesser).playerId)?.score).toBe(0);
  }, 30_000);

  it("skips the turn of a player who is absent when their turn begins", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await waitForPhase(alice, "drawing", 10_000);

    // One non-drawer leaves permanently during turn 1.
    const drawerId = alice.state.drawerPlayerId;
    const absent = participantRooms([alice, bob, carol]).find(
      (room) => selfPlayer(room).playerId !== drawerId,
    );
    if (!absent) {
      throw new Error("Expected an absent player room");
    }
    const absentPlayerId = selfPlayer(absent).playerId;
    await absent.leave();

    await waitFor(
      () =>
        alice.state.drawerPlayerId === absentPlayerId &&
        alice.state.phase === "result" &&
        alice.state.lastResult?.outcome === "skipped",
      15_000,
    );
    expect(alice.state.lastResult?.drawerPlayerId).toBe(absentPlayerId);
    expect(alice.state.players.get(absentPlayerId)?.score).toBe(0);
    await waitFor(() => alice.state.turnNumber > 2, 15_000);
    expect(alice.state.totalTurns).toBe(9);
  }, 30_000);

  it("lets a mid-game spectator watch, prevents guessing, and includes them in the next game", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);
    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "live-drawing-guessing" });
    await waitFor(() => aliceLobby.state.gameId === "live-drawing-guessing");
    const aliceTransition = waitForTransition(aliceLobby);
    const bobTransition = waitForTransition(bobLobby);
    aliceLobby.send("start_game", {});
    const [alicePayload, bobPayload] = await Promise.all([aliceTransition, bobTransition]);
    const alice = await consumeGame(test, alicePayload.reservation);
    const bob = await consumeGame(test, bobPayload.reservation);
    await waitForPhase(alice, "drawing", 10_000);
    await waitForPlayers(bob, 2);

    const spectatorJoin = await joinRoomHttp(test, created.body.room.code, "Spectator");
    expect(spectatorJoin.response.status).toBe(200);
    if (!spectatorJoin.body.reservation) {
      throw new Error("Expected a spectator reservation");
    }
    const spectator = await consumeGame(test, spectatorJoin.body.reservation);
    await waitFor(
      () => [...spectator.state.players.values()].some((player) => player.name === "Spectator"),
      5_000,
    );
    const spectatorPlayer = [...spectator.state.players.values()].find(
      (player) => player.sessionId === spectator.sessionId,
    );
    expect(spectatorPlayer?.isSpectator).toBe(true);
    expect(spectator.state.phase).toBe("drawing");

    const notGuesser = waitForGuessFeedback(spectator, "not-guesser");
    guess(spectator, "anything");
    await notGuesser;

    // Finish the two-player match with solved turns.
    for (let turn = 1; turn <= 6; turn += 1) {
      await playSolvedTurn([alice, bob], turn);
    }
    await waitForPhase(alice, "finished", 15_000);

    alice.send(ROOM_MESSAGE_TYPES.playAgain, {});
    await waitForPhase(alice, "preparing", 10_000);
    expect(alice.state.totalTurns).toBe(9);
    const spectatorAgain = [...alice.state.players.values()].find(
      (player) => player.playerId === spectatorPlayer?.playerId,
    );
    expect(spectatorAgain?.isSpectator).toBe(false);
    expect([...alice.state.players.values()]).toHaveLength(3);
    expect(alice.state.drawerPlayerId).not.toBe("");
  }, 60_000);

  it("rejects forged matchmaking creation and forged seats", async () => {
    await expect(
      matchMaker.create(LIVE_DRAWING_GUESSING_ROOM_TYPE, {
        roomCode: "ABCDEF",
        players: playerIds(2),
      }),
    ).rejects.toThrow();

    const { room, reservations } = await createDirectRoom(2);
    await consumeGame(test, reservations[0]);
    await consumeGame(test, reservations[1]);
    await expect(
      matchMaker.joinById(room.roomId, {
        playerId: "00000000-0000-4000-8000-999999999999",
        playerName: "Forged",
      }),
    ).rejects.toThrow();
    // joinById reserves a seat; the duplicate identity is rejected when the
    // reservation is consumed by the already-connected player.
    const duplicateReservation = await matchMaker.joinById(
      room.roomId,
      {
        playerId: playerIds(2)[0]?.playerId ?? "00000000-0000-4000-8000-000000000000",
        playerName: "Player 0",
      },
      authContext(),
    );
    await expect(
      test.testServer.sdk.consumeSeatReservation(duplicateReservation, LiveDrawingGuessingState),
    ).rejects.toThrow();
  }, 30_000);

  it("runs an eight-player match to final results with every player drawing three times", async () => {
    const { reservations } = await createDirectRoom(8);
    const rooms: SendRoom[] = [];
    for (const reservation of reservations) {
      rooms.push(await consumeGame(test, reservation));
    }
    const alice = rooms[0];
    if (!alice) {
      throw new Error("No rooms");
    }
    await waitForPhase(alice, "preparing", 10_000);

    const drawers = new Map<number, string>();
    let lastTurn = 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 60_000 && alice.state.phase !== "finished") {
      const turn = alice.state.turnNumber;
      if (turn !== lastTurn && turn > 0) {
        drawers.set(turn, alice.state.drawerPlayerId);
        lastTurn = turn;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await waitForPhase(alice, "finished", 30_000);

    expect(drawers.size).toBe(24);
    const counts = new Map<string, number>();
    for (const drawerId of drawers.values()) {
      counts.set(drawerId, (counts.get(drawerId) ?? 0) + 1);
    }
    for (const player of [...alice.state.players.values()]) {
      expect(counts.get(player.playerId)).toBe(3);
      expect(player.score).toBe(0);
    }
    const result = alice.state.result;
    if (result === null) {
      throw new Error("Expected a match result");
    }
    expect(result.winnerPlayerIds).toHaveLength(8);
    expect(result.leaderboard).toHaveLength(8);
    for (const entry of result.leaderboard) {
      expect(entry.rank).toBe(1);
      expect(entry.score).toBe(0);
    }
    for (const room of rooms.slice(1)) {
      await waitFor(() => room.state.phase === "finished", 15_000);
      expect(room.state.result?.leaderboard).toHaveLength(8);
      expect(room.state.phase).toBe("finished");
    }
  }, 120_000);
});
