import { MapSchema, Schema, type } from "@colyseus/schema";
import type { LiveDrawingLanguage } from "./live-drawing-guessing.js";

export class LobbyPlayerState extends Schema {
  @type("string") playerId = "";
  @type("string") name = "";
  @type("boolean") isHost = false;
}

export class LobbyRoomState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  /** Lobby-wide language used by Live Drawing & Guessing. */
  @type("string") language: LiveDrawingLanguage = "en";
  @type("string") hostSessionId = "";
  @type({ map: LobbyPlayerState }) players = new MapSchema<LobbyPlayerState>();
}
