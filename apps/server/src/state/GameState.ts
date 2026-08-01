import { MapSchema, Schema, type } from "@colyseus/schema";

import type { MatchPhase } from "@falling-platforms/shared";

import { PlatformState } from "./PlatformState.js";
import { PlayerState } from "./PlayerState.js";

export class GameState extends Schema {
  @type("string") phase: MatchPhase = "lobby";
  @type("string") hostSessionId = "";
  @type("string") roomCode = "";
  @type("string") winnerSessionId = "";
  @type("boolean") draw = false;

  @type("number") roundNumber = 0;
  @type("number") aliveCount = 0;
  @type("number") arenaSide = 0;
  @type("number") matchStartedAt = 0;

  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();

  @type({ map: PlatformState })
  platforms = new MapSchema<PlatformState>();
}
