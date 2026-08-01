import { Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") name = "";
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
  @type("number") joinedOrder = 0;
}
