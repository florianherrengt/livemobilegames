import type { Room, RoomOptions } from "@colyseus/core";
import type { GameManifest } from "@phone-party/protocol";

export type GameDefinition = {
  readonly manifest: GameManifest;
  readonly roomType: string;
  // Colyseus's generic Room surface is not assignable from subclasses under
  // exactOptionalPropertyTypes; this constructor boundary is covered by the
  // room integration tests.
  readonly roomClass: new (
    ...args: unknown[]
  ) => Room<RoomOptions>;
};
