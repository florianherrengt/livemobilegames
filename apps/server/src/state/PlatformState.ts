import { Schema, type } from "@colyseus/schema";

import type { PlatformStateValue } from "@falling-platforms/shared";

export class PlatformState extends Schema {
  @type("string") id = "";
  @type("number") gridX = 0;
  @type("number") gridY = 0;
  @type("string") state: PlatformStateValue = "stable";
}
