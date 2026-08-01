import { MapSchema, type } from "@colyseus/schema";

import { PlatformPlayerState, PlatformState } from "./platform-state.js";

export class GamePlayerState extends PlatformPlayerState {
  @type("boolean") alive = false;
}

export class GameState extends PlatformState {
  @type({ map: GamePlayerState }) players = new MapSchema<GamePlayerState>();
}
