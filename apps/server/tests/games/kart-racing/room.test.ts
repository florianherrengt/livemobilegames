import { randomBytes } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import {
  type ISeatReservation,
  KART_RACING_MESSAGE_TYPES,
  KART_RACING_TRACK,
  KartRacingState,
  LobbyRoomState,
  nearestRoadPoint,
  ROOM_MESSAGE_TYPES,
  type RoomTransition,
} from "@phone-party/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameRegistry } from "../../../src/games/game-registry.js";
import { KART_RACING_SERVER_CONSTANTS } from "../../../src/games/kart-racing/constants.js";
import {
  createKartRacingGameDefinition,
  KART_RACING_ROOM_TYPE,
} from "../../../src/games/kart-racing/definition.js";
import { angleDifference, pointAlongCenterline } from "../../../src/games/kart-racing/track.js";
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

async function consumeLobby(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    LobbyRoomState,
  );
}

async function consumeGame(test: TestPlatform, reservation: unknown) {
  return test.testServer.sdk.consumeSeatReservation(
    reservation as ISeatReservation,
    KartRacingState,
  );
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
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${code}`)), 10_000);
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

function waitForCommandRejection(
  room: MessageRoom,
  sequence: number,
): Promise<{
  commandType: string;
  sequence: number;
  raceNumber: number;
  reason: string;
}> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for command rejection ${sequence}`)),
      10_000,
    );
    const off = room.onMessage("*", (type, payload) => {
      if (type === KART_RACING_MESSAGE_TYPES.commandRejected) {
        const rejection = payload as {
          commandType: string;
          sequence: number;
          raceNumber: number;
          reason: string;
        };
        if (rejection.sequence === sequence) {
          clearTimeout(timer);
          off();
          resolve(rejection);
        }
      }
    });
  });
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

async function createDirectRoom(count = 2) {
  const players = playerIds(count);
  const room = await matchMaker.create(KART_RACING_ROOM_TYPE, {
    roomCode: "ABCDEF",
    players,
    e2eMode: true,
    transitionTimeoutMs: 5_000,
    roomCreationToken: ROOM_CREATION_TOKEN,
  });
  const reservations = [];
  for (const player of players) {
    reservations.push(
      await matchMaker.joinById(room.roomId, {
        playerId: player.playerId,
        playerName: player.playerName,
      }),
    );
  }
  return { room, players, reservations };
}

function computeSteering(player: { kartX: number; kartY: number; kartHeading: number }): number {
  const hx = Math.cos(player.kartHeading);
  const hy = Math.sin(player.kartHeading);
  for (const obstacle of KART_RACING_TRACK.obstacles) {
    const dx = obstacle.x - player.kartX;
    const dy = obstacle.y - player.kartY;
    const ahead = dx * hx + dy * hy;
    if (ahead < 0 || ahead > 160) {
      continue;
    }
    const lateral = -dx * hy + dy * hx;
    const clear = obstacle.radius + KART_RACING_SERVER_CONSTANTS.KART_RADIUS + 18;
    if (Math.abs(lateral) < clear) {
      return lateral > 0 ? -1 : 1;
    }
  }
  const nearest = nearestRoadPoint(KART_RACING_TRACK, {
    x: player.kartX,
    y: player.kartY,
  });
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < KART_RACING_TRACK.centerline.length; index++) {
    const point = KART_RACING_TRACK.centerline[index] ?? { x: 0, y: 0 };
    const distance = Math.hypot(nearest.x - point.x, nearest.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  const target = pointAlongCenterline(KART_RACING_TRACK, bestIndex, 150);
  const desired = Math.atan2(target.y - player.kartY, target.x - player.kartX);
  const error = angleDifference(player.kartHeading, desired);
  return Math.max(-1, Math.min(1, error * 1.8));
}

async function driveClient(
  room: {
    state: KartRacingState;
    sessionId: string;
    send: (type: string, message?: unknown) => void;
  },
  maxMs: number,
  shoot = false,
  stopWhenPhase: string | undefined = undefined,
): Promise<{ sawProjectile: boolean; sawHitStop: boolean }> {
  let steerSequence = 1;
  let shootSequence = 1;
  let lastShotAt = 0;
  let sawProjectile = false;
  let sawHitStop = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    const state = room.state;
    if (state.phase === "finished" || state.phase === stopWhenPhase) {
      break;
    }
    if (state.phase === "countdown" || state.phase === "racing") {
      const player = state.players.get(room.sessionId);
      if (player) {
        const steering = computeSteering(player);
        room.send(KART_RACING_MESSAGE_TYPES.steer, {
          type: "steer",
          sequence: steerSequence++,
          raceNumber: state.raceNumber,
          steering,
        });
        if (
          shoot &&
          state.phase === "racing" &&
          player.ammoLoaded &&
          Date.now() - lastShotAt > 700
        ) {
          room.send(KART_RACING_MESSAGE_TYPES.shoot, {
            type: "shoot",
            sequence: shootSequence++,
            raceNumber: state.raceNumber,
          });
          lastShotAt = Date.now();
        }
      }
      if (state.projectiles.length > 0) {
        sawProjectile = true;
      }
      for (const player of state.players.values()) {
        if (player.hitStopRemainingMs > 0) {
          sawHitStop = true;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { sawProjectile, sawHitStop };
}

async function runFullMatch(
  alice: {
    state: KartRacingState;
    sessionId: string;
    send: (type: string, message?: unknown) => void;
  },
  bob: {
    state: KartRacingState;
    sessionId: string;
    send: (type: string, message?: unknown) => void;
  },
  timeoutMs: number,
): Promise<{
  alice: { sawProjectile: boolean; sawHitStop: boolean };
  bob: { sawProjectile: boolean; sawHitStop: boolean };
}> {
  const [aliceResult, bobResult] = await Promise.all([
    driveClient(alice, timeoutMs, true),
    driveClient(bob, timeoutMs, true),
  ]);
  return { alice: aliceResult, bob: bobResult };
}

describe("Kart Racing room integration", () => {
  let test: TestPlatform;

  beforeEach(async () => {
    test = await createTestPlatform(
      createGameRegistry([createKartRacingGameDefinition(ROOM_CREATION_TOKEN)]),
      createTestConfig(E2E_CONFIG),
      ROOM_CREATION_TOKEN,
    );
  });

  afterEach(async () => {
    await stopTestPlatform(test);
  });

  it("runs the full lobby-to-game transition, three-race match, and play-again flow with two clients", async () => {
    const created = await createRoomHttp(test, "Alice");
    const aliceLobby = await consumeLobby(test, created.body.reservation);
    await waitFor(() => aliceLobby.state.roomCode === created.body.room.code);

    const joined = await joinRoomHttp(test, created.body.room.code, "Bob");
    const bobLobby = await consumeLobby(test, joined.body.reservation);
    await waitFor(() => aliceLobby.state.players.size === 2);

    aliceLobby.send("select_game", { gameId: "kart-racing" });
    await waitFor(() => aliceLobby.state.gameId === "kart-racing");

    const bobStartError = waitForRoomError(bobLobby, "NOT_HOST");
    bobLobby.send("start_game", {});
    await bobStartError;

    const aliceTransition = waitForTransition(aliceLobby);
    const bobTransition = waitForTransition(bobLobby);
    aliceLobby.send("start_game", {});

    const [alicePayload, bobPayload] = await Promise.all([aliceTransition, bobTransition]);
    const aliceGame = await consumeGame(test, alicePayload.reservation);
    const bobGame = await consumeGame(test, bobPayload.reservation);
    await waitFor(() => aliceGame.state.players.size === 2);
    await waitFor(() => aliceGame.state.phase === "countdown");
    expect(bobGame.state.phase).toBe("countdown");
    expect(aliceGame.state.roomCode).toBe(created.body.room.code);
    expect(aliceGame.state.gameId).toBe("kart-racing");
    expect(aliceGame.state.totalRaces).toBe(3);
    expect(aliceGame.state.lapsPerRace).toBe(3);
    expect(aliceGame.state.crates.length).toBeGreaterThan(0);
    expect(aliceGame.state.crates.length).toBe(bobGame.state.crates.length);
    expect("raceSeed" in aliceGame.state).toBe(false);

    await waitFor(() => aliceGame.state.phase === "racing", 10_000);
    expect(bobGame.state.phase).toBe("racing");

    const results = await runFullMatch(aliceGame, bobGame, 300_000);
    expect(aliceGame.state.phase).toBe("finished");
    expect(bobGame.state.phase).toBe("finished");
    expect(aliceGame.state.raceNumber).toBe(3);
    expect(bobGame.state.raceNumber).toBe(3);
    expect(results.alice.sawProjectile).toBe(true);
    expect(results.bob.sawProjectile).toBe(true);
    expect(results.alice.sawHitStop || results.bob.sawHitStop).toBe(true);

    const aliceResult = aliceGame.state.result;
    const bobResult = bobGame.state.result;
    if (aliceResult === null || bobResult === null) {
      throw new Error("Expected a match result on every client");
    }
    expect([...aliceResult.winnerSessionIds]).toEqual([...bobResult.winnerSessionIds]);
    expect([...aliceResult.leaderboard]).toEqual([...bobResult.leaderboard]);
    const totalPoints = [...aliceResult.leaderboard].reduce(
      (sum, entry) => sum + entry.matchPoints,
      0,
    );
    expect(totalPoints).toBe(42);

    const nonHostAgain = waitForRoomError(bobGame, "NOT_HOST");
    bobGame.send("play_again", {});
    await nonHostAgain;
    aliceGame.send("play_again", {});
    await waitFor(() => aliceGame.state.phase === "countdown");
    await waitFor(() => bobGame.state.phase === "countdown");
    expect(aliceGame.state.raceNumber).toBe(1);
    expect(aliceGame.state.players.get(aliceGame.sessionId)?.matchPoints).toBe(0);
  }, 360_000);

  it("derives the actor from the connection and rejects forged, stale, and out-of-phase commands", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bobRoom = await consumeGame(test, reservations[1]);
    const countdownShoot = waitForCommandRejection(alice, 30);
    alice.send("game:shoot", { type: "shoot", sequence: 30, raceNumber: 1 });
    expect((await countdownShoot).reason).toBe("not-racing");

    await waitFor(() => alice.state.phase === "racing", 10_000);
    const aliceSession = alice.sessionId;

    const invalidCommand = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:steer", { type: "steer", sequence: 1, raceNumber: 1, steering: "left" });
    await invalidCommand;

    const forged = waitForRoomError(alice, "INVALID_GAME_COMMAND");
    alice.send("game:steer", {
      type: "steer",
      sequence: 2,
      raceNumber: 1,
      steering: 0,
      playerId: "forged",
      x: 999,
      winner: true,
    });
    await forged;

    const oldRace = waitForCommandRejection(alice, 10);
    alice.send("game:steer", {
      type: "steer",
      sequence: 10,
      raceNumber: 99,
      steering: 0,
    });
    expect((await oldRace).reason).toBe("old-race");

    const noAmmo = waitForCommandRejection(alice, 11);
    alice.send("game:shoot", { type: "shoot", sequence: 11, raceNumber: 1 });
    expect((await noAmmo).reason).toBe("no-ammo");

    alice.send("game:steer", {
      type: "steer",
      sequence: 12,
      raceNumber: 1,
      steering: 0.3,
    });
    const stale = waitForCommandRejection(alice, 12);
    alice.send("game:steer", {
      type: "steer",
      sequence: 12,
      raceNumber: 1,
      steering: -0.3,
    });
    expect((await stale).reason).toBe("stale-sequence");

    // Steering from Alice must not steer Bob; Bob only auto-accelerates.
    const bobHeading = bobRoom.state.players.get(bobRoom.sessionId)?.kartHeading ?? 0;
    alice.send("game:steer", {
      type: "steer",
      sequence: 20,
      raceNumber: 1,
      steering: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(alice.state.players.get(aliceSession)?.kartHeading).not.toBeCloseTo(0, 1);
    expect(bobRoom.state.players.get(bobRoom.sessionId)?.kartHeading).toBeCloseTo(bobHeading, 1);
  }, 60_000);

  it("keeps the race alive and respawns a reconnecting player without deadlock", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "racing", 10_000);
    const aliceSessionId = alice.sessionId;

    // Colyseus clients only attempt/allow automatic reconnection after the
    // room has been up for its 5s minimum; wait so the drop is a real
    // mid-race disconnect rather than a join-phase race.
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    alice.connection.close();
    await waitFor(
      () => bob.state.players.get(aliceSessionId)?.connectionStatus === "reconnecting",
      10_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await waitFor(
      () => bob.state.players.get(aliceSessionId)?.connectionStatus === "connected",
      20_000,
    );
    await waitFor(
      () =>
        (bob.state.players.get(aliceSessionId)?.respawnRemainingMs ?? 0) > 0 ||
        (bob.state.players.get(aliceSessionId)?.immunityRemainingMs ?? 0) > 0,
      10_000,
    );
    await Promise.all([
      driveClient(bob, 60_000, false, "race-result"),
      driveClient(alice, 60_000, false, "race-result"),
    ]);
    await waitFor(() => bob.state.phase === "race-result", 30_000);
    expect(bob.state.players.get(aliceSessionId)).toBeDefined();
  }, 90_000);

  it("supports eight real clients through a complete match with consistent state", async () => {
    const { reservations } = await createDirectRoom(8);
    const rooms = [];
    for (const reservation of reservations) {
      rooms.push(await consumeGame(test, reservation));
    }
    const host = rooms[0];
    if (!host) {
      throw new Error("missing host room");
    }
    await waitFor(() => host.state.players.size === 8);
    await waitFor(() => host.state.phase === "countdown");
    await waitFor(() => host.state.phase === "racing", 10_000);
    for (const room of rooms) {
      expect(room.state.phase).toBe("racing");
      expect(room.state.players.size).toBe(8);
    }
    const drive = await Promise.all(rooms.map((room) => driveClient(room, 360_000, false)));
    await waitFor(() => host.state.phase === "finished", 20_000);
    for (const room of rooms) {
      expect(room.state.phase).toBe("finished");
      expect(room.state.result).not.toBeNull();
      expect([...(room.state.result?.leaderboard ?? [])]).toEqual([
        ...(host.state.result?.leaderboard ?? []),
      ]);
    }
    expect(drive.length).toBe(8);
  }, 480_000);

  it("resolves simultaneous steering from both clients on each kart", async () => {
    const { reservations } = await createDirectRoom();
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    await waitFor(() => alice.state.phase === "racing", 10_000);

    const aliceStartHeading = alice.state.players.get(alice.sessionId)?.kartHeading ?? 0;
    const bobStartHeading = bob.state.players.get(bob.sessionId)?.kartHeading ?? 0;
    alice.send("game:steer", {
      type: "steer",
      sequence: 1,
      raceNumber: 1,
      steering: 1,
    });
    bob.send("game:steer", {
      type: "steer",
      sequence: 1,
      raceNumber: 1,
      steering: -1,
    });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const aliceHeading = alice.state.players.get(alice.sessionId)?.kartHeading ?? 0;
    const bobHeading = bob.state.players.get(bob.sessionId)?.kartHeading ?? 0;
    expect(Math.abs(aliceHeading - aliceStartHeading)).toBeGreaterThan(0.05);
    expect(Math.abs(bobHeading - bobStartHeading)).toBeGreaterThan(0.05);
  }, 60_000);

  it("starts play again with the remaining players after a permanent mid-match leave", async () => {
    const { reservations } = await createDirectRoom(3);
    const alice = await consumeGame(test, reservations[0]);
    const bob = await consumeGame(test, reservations[1]);
    const carol = await consumeGame(test, reservations[2]);
    await waitFor(() => alice.state.players.size === 3);
    await waitFor(() => alice.state.phase === "racing", 10_000);

    await bob.leave();
    await waitFor(() => alice.state.players.get(bob.sessionId)?.removed === true, 10_000);

    await Promise.all([driveClient(alice, 360_000, false), driveClient(carol, 360_000, false)]);
    await waitFor(() => alice.state.phase === "finished", 20_000);

    alice.send("play_again", {});
    await waitFor(() => alice.state.phase === "countdown", 10_000);
    expect(alice.state.raceNumber).toBe(1);
    expect(alice.state.players.size).toBe(2);
    expect(alice.state.players.get(bob.sessionId)).toBeUndefined();
    expect(carol.state.phase).toBe("countdown");
  }, 480_000);

  it("rejects direct matchmaking creation without the server room token", async () => {
    await expect(
      matchMaker.create(KART_RACING_ROOM_TYPE, {
        roomCode: "ABCDEF",
        players: playerIds(2),
      }),
    ).rejects.toThrow();
  });
});
