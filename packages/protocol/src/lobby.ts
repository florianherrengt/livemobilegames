import { MapSchema, Schema, type } from "@colyseus/schema";

export class LobbyPlayerState extends Schema {
  @type("string") playerId = "";
  @type("string") name = "";
  @type("boolean") isHost = false;
}

export class LobbyRoomState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type({ map: LobbyPlayerState }) players = new MapSchema<LobbyPlayerState>();
}
