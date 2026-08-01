import { MapSchema, Schema, type } from "@colyseus/schema";

import { PlatformPlayerState, PlatformState } from "@falling-platforms/platform-schema";
import type { MatchRuntime } from "./runtime.js";
import type { MatchPhase, PlatformStateValue } from "./types.js";

export class FallingPlatformsPlayerState extends PlatformPlayerState {
  @type("boolean") connected = true;
  @type("boolean") participating = false;
  @type("boolean") alive = false;
  @type("boolean") jumping = false;
  @type("string") currentPlatformId = "";
  @type("string") fromPlatformId = "";
  @type("string") targetPlatformId = "";
  @type("number") jumpStartedAt = 0;
  @type("number") jumpEndsAt = 0;
  @type("number") lastAcceptedSequence = 0;
}

export class FallingPlatformPlatformState extends Schema {
  @type("string") id = "";
  @type("number") gridX = 0;
  @type("number") gridY = 0;
  @type("string") state: PlatformStateValue = "stable";
}

export class FallingPlatformsState extends PlatformState {
  @type("string") phase: MatchPhase = "lobby";
  @type("string") winnerSessionId = "";
  @type("boolean") draw = false;
  @type("number") roundNumber = 0;
  @type("number") aliveCount = 0;
  @type("number") arenaSide = 0;
  @type("number") matchStartedAt = 0;
  @type({ map: FallingPlatformsPlayerState })
  players = new MapSchema<FallingPlatformsPlayerState>();
  @type({ map: FallingPlatformPlatformState })
  platforms = new MapSchema<FallingPlatformPlatformState>();

  /** Non-synchronized server-side runtime, never encoded. */
  runtime: MatchRuntime | null = null;
}
