import { MapSchema, Schema, type } from "@colyseus/schema";
import { type GameManifest, roomOptionsSchema, seatOptionsSchema } from "@phone-party/protocol";
import { type Client, ErrorCode, Room, ServerError } from "colyseus";

import type { GameDefinition } from "../../src/games/game-definition.js";

export const TEST_ROOM_TYPE = "test-platform-room";

class TestPlayerState extends Schema {
  @type("string") playerId = "";
  @type("string") name = "";
}

export class TestRoomState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type({ map: TestPlayerState }) players = new MapSchema<TestPlayerState>();
}

class TestPlatformRoom extends Room<{ state: TestRoomState }> {
  declare state: TestRoomState;
  override maxClients = 2;

  readonly connectedPlayerIds = new Set<string>();
  disposed = false;

  override onCreate(options: unknown): void {
    const parsed = roomOptionsSchema.safeParse(options);
    this.state = new TestRoomState();
    this.state.roomCode = parsed.success ? parsed.data.roomCode : "";
    this.state.gameId = "";
  }

  override onJoin(client: Client, options: unknown): void {
    const parsed = seatOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "Invalid join options");
    }
    this.connectedPlayerIds.add(client.sessionId);
    const player = new TestPlayerState();
    player.playerId = parsed.data.playerId;
    player.name = parsed.data.playerName;
    this.state.players.set(client.sessionId, player);
  }

  override onLeave(client: Client): void {
    this.connectedPlayerIds.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  override onDispose(): void {
    this.disposed = true;
  }
}

const testManifest: GameManifest = {
  id: "test-platform-room",
  name: "Test Platform Room",
  description: "Test-only room used to verify platform infrastructure. Never shown in production.",
  version: 1,
  minPlayers: 1,
  maxPlayers: 2,
  orientation: "any",
};

export const testGameDefinition: GameDefinition = {
  manifest: testManifest,
  roomType: TEST_ROOM_TYPE,
  roomClass: TestPlatformRoom,
};
