import type { Client, Room } from "@colyseus/sdk";
import {
  FALLING_PLATFORMS_GAME_ID,
  FallingPlatformPlatformState,
  type FallingPlatformsPhase,
  FallingPlatformsPlayerState,
  FallingPlatformsState,
} from "@phone-party/protocol";

import type { RoomConnection, RoomState } from "../../game-connection.js";

function addPlatforms(state: FallingPlatformsState, side: number): void {
  for (let gridY = 0; gridY < side; gridY++) {
    for (let gridX = 0; gridX < side; gridX++) {
      const platform = new FallingPlatformPlatformState();
      platform.id = `${gridX}:${gridY}`;
      platform.gridX = gridX;
      platform.gridY = gridY;
      state.platforms.set(platform.id, platform);
    }
  }
}

/** Deterministic Falling Platforms state for Storybook and component tests. */
export function makeFallingPlatformsState(
  phase: FallingPlatformsPhase,
  options: {
    roundNumber?: number;
    aliveCount?: number;
    winnerSessionId?: string;
    draw?: boolean;
    hostSessionId?: string;
    alicePlatform?: string;
    aliceJumping?: boolean;
    aliceAlive?: boolean;
    bobPlatform?: string;
    aliceConnected?: boolean;
    bobAlive?: boolean;
  } = {},
): FallingPlatformsState {
  const state = new FallingPlatformsState();
  state.roomCode = "ABC234";
  state.gameId = FALLING_PLATFORMS_GAME_ID;
  state.phase = phase;
  state.roundNumber = options.roundNumber ?? (phase === "lobby" ? 0 : 1);
  state.aliveCount = options.aliveCount ?? 2;
  state.winnerSessionId = options.winnerSessionId ?? "";
  state.draw = options.draw ?? false;
  state.hostSessionId = options.hostSessionId ?? "host-session";
  if (phase === "playing" || phase === "results") {
    state.arenaSide = 7;
    state.matchStartedAt = Date.now() - 1_000;
    addPlatforms(state, 7);
  }

  const alice = new FallingPlatformsPlayerState();
  alice.name = "Alice";
  alice.connected = options.aliceConnected ?? true;
  alice.participating = true;
  alice.alive = options.aliceAlive ?? true;
  alice.jumping = options.aliceJumping ?? false;
  alice.currentPlatformId = options.alicePlatform ?? "3:3";
  if (alice.jumping) {
    alice.fromPlatformId = options.alicePlatform ?? "3:3";
    alice.targetPlatformId = "4:3";
    alice.jumpStartedAt = Date.now() - 100;
    alice.jumpEndsAt = Date.now() + 260;
  }
  alice.joinedOrder = 0;
  state.players.set("host-session", alice);

  const bob = new FallingPlatformsPlayerState();
  bob.name = "Bob";
  bob.connected = true;
  bob.participating = true;
  bob.alive = options.bobAlive ?? true;
  bob.currentPlatformId = options.bobPlatform ?? "3:4";
  bob.joinedOrder = 1;
  state.players.set("bob-session", bob);
  return state;
}

/** A fake connection whose room records sent messages for assertions. */
export function makeRoomConnection(state: FallingPlatformsState) {
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
